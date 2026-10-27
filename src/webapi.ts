import express, {NextFunction, Request, Response} from 'express';
import cors from 'cors';
import { auth as apiAuth, requiredScopes } from "express-oauth2-jwt-bearer"
import oidc from 'express-openid-connect';
const {auth, requiresAuth}=oidc;
import QRCode from "qrcode";
import dotenv from 'dotenv'
import path from 'node:path';
import {Pool} from 'pg'
import { renderPage } from './views.ts';

const pool =new Pool({
    user:process.env.DB_USER,
    host: process.env.DB_HOST,
    database: 'projekt1_baza',
    password:process.env.DB_PASSWORD,
    port:5432,
    ssl:true
})

const app=express();
const port=Number(process.env.PORT ?? 3000);
const hostname=process.env.HOSTNAME ?? "0.0.0.0";
app.use(cors());

const publicUrl=process.env.PUBLIC_URL?.replace(/\/+$/,"");

const config={
    authRequired:false,
    idpLogout: true,
    secret: process.env.SECRET,
    baseURL:`http://${hostname}:${port}`,
    clientID:process.env.CLIENT_ID,
    issuerBaseURL:'https://dev-gfp2kmjnfixxpg2j.us.auth0.com/',
    clientSecret:process.env.CLIENT_SECRET,
    routes:{
        logout: false as const
    },
    authorizationParams:{
        response_type:'code',
        scope: "openid profile email"
    },
};
app.use(auth(config));

const checkJwt=apiAuth({
    issuerBaseURL:'',
    audience:"auth audience"
})
const authServer='';

type PassStatus="ACTIVE"|"CANCELLED";

function isLoggedIn(req: Request):boolean{
    return Boolean(
        req.oidc && req.oidc.isAuthenticated()
    );
}

function requireWebLogin(
    req:Request,
    res:Response,
    next:NextFunction
): void{
    if(!isLoggedIn(req)){
        res.redirect("/login");
        return;
    }
    next();
}

interface PassRow{
    id:string;
    name:string;
    document: string;
    issued_at:Date;
    status: PassStatus;
}

interface Pass{
    id: string;
    name: string;
    document: string;
    issuedAt: Date;
    status: PassStatus;
}
app.post('/logout',(req,res)=>res.oidc.logout());

function getNavigation(req: Request):string{
    if(isLoggedIn(req)){
        return `
        <a href="/passes">Propusnice</a>
        <form
        method="post"
        action="/logout"
        style="display: inline;">
        <button type="submit">Odjava</button>
        </form>`;
    }
    return `
    <a href="/login">Prijava</a>`;
}

//početna javna stranica - ukupan broj propusnica
app.get("/",async(req,res,next)=>{
    try{
        const result=await pool.query<{
            total:string;
            active: string;
        }>(`
            SELECT COUNT(*)::text AS total,
            COUNT(*) FILTER(WHERE status='ACTIVE')::text AS active FROM passes`);
        const row=result.rows[0];
        const html= await renderPage("Početna","home.html",{
            TOTAL: String(row?.total ?? 0),
            ACTIVE: String(row?.active ?? 0),
            AUTHENTICATION_MESSAGE: isLoggedIn(req) ?`
            <p> Korisnik je prijavljen.<p>
            <a href="/passes">Otvori upravljanje propusnicama</a>`
            :`<p>Za pregled i upravljanje propusnicama potrebna je prijava.</p>
            < href="/login">Prijava korisnika</a>`
        },getNavigation(req)
        );
        res.send(html);

    }catch(error){
        next(error);
    }
});

app.get("/sign-up",(req,res)=>{
    res.oidc.login({
        returnTo:"/",
        authorizationParams:{
            screen_hint: "signup"
        }
    });
});

function mapPass(row:PassRow):Pass{
    return{
        id: row.id,
        name:row.name,
        document: row.document,
        issuedAt:row.issued_at,
        status:row.status
    };
}

app.get("/info/:id",async (req,res,next)=>{
    try{
        const result= await pool.query<PassRow>(
            `SELECT id, name, document, issued_at, status
            FROM passes
            WHERE id=$1`,[req.params.id]
        );
        const row=result.rows[0];

        if(!row){
            const html=await renderPage("Propusnica nije pronađena","not-found.html",{},
                getNavigation(req)
            );
            res.status(404).send(html);
            return;
        }
        const pass=mapPass(row);
        const html= await renderPage(
            "Informacije o propusnici",
            "info.html",
            {STATUS_CLASS: pass.status==="ACTIVE" ? "active":"cancelled",
                STATUS: pass.status,
                ID: pass.id,
                NAME: pass.name,
                DOCUMENT: pass.document,
                ISSUED_AT: pass.issuedAt
            }, getNavigation(req)
        );
        res.send(html);
    }catch(error){
        next(error);
    }
});
function passToJson(pass:Pass){
    return{
        id: pass.id,
        name:pass.name,
        document: pass.document,
        issuedAt:pass.issuedAt,
        status: pass.status
    };
}

app.get("/passes",requiresAuth(),
async (req,res,next)=>{
    try{
        const result=await pool.query<PassRow>(
            `SELECT id, name, document, issued_at, status
            FROM passes
            ORDER BY issued_at DESC`
        );
        const passes=result.rows.map(mapPass);
        const passesContent= passes.length===0 ? `<p> Trenutno nema izdanih propusnica </p>`:
        `<table>
            <thead>
                <tr>
                    <th>Ime</th>
                    <th>Dokument</th>
                    <th>Status</th>
                    <th>Vrijeme izdavanja</th>
                    <th>Akcije</th>
                </tr>
            </thead>
            <tbody>${passes.map((pass)=>{
                const statusClass=pass.status=='ACTIVE' ? "active":"cancelled";
                return `<tr>
                            <td>
                                ${pass.name}
                            </td>
                            <td>
                                ${pass.document}
                            </td>
                            <td>
                                <span class="${statusClass}">
                                    ${pass.status}
                                </span>
                            </td>
                            <td>
                                ${pass.issuedAt}
                            </td>
                            <td>
                                <a href="/info/${encodeURIComponent(pass.id)}">Javna stranica</a>
                                ${pass.status==="ACTIVE" ? `<form method="post"
                                    action="/passes/${encodeURIComponent(pass.id)}/cancel">
                                    <button class="warning" type="submit">Poništi</button></form>`:""}
                                    <form method="post"
                                    action="/passes/${encodeURIComponent(pass.id)}/delete"
                                    onsubmit="return confirm('Obrisati propusnicu?');">
                                    <button class="danger" type="submit">Obriši</button>
                                    </form>
                                </td>
                            </tr>`;
                            
            }).join("")}
            </tbody>
        </table>`;
        const html= await renderPage("Propusnice","passes.html",{PASSES_CONTENT: passesContent},getNavigation(req));
        res.send(html);

    }catch(error){
        next(error);
    }
});
const apiRouter=express.Router();
apiRouter.use(checkJwt);

apiRouter.get("/:id",requiredScopes("read:passes"),
async(req,res,next)=>{
    const accessToken=req.auth?.token;

    if(!accessToken){
        res.status(401).json({
            error:"missing_token"
        });
        return;
    }
    try{
        const result= await pool.query<PassRow>(
            `SELECT id, name, document, issued_at, status
            FROM passes
            WHERE id=$1`,
            [req.params.id]
        );
        const row=result.rows[0];
        if(!row){
            res.status(404).json({
                error:"pass_not_found"
            });
            return;
        }
        const pass=mapPass(row);
        res.status(200).json(
            passToJson(pass)
        );
    }catch(error){
        next(error);
    }
});

apiRouter.post("/",requiredScopes("create:passes"),
async (req,res, next)=>{
    const accessToken=req.auth?.token;
    if(!accessToken){
        res.status(401).json({
            error:"missing_token"
        });
        return
    }
    try{
        const name= typeof req.body?.name ==="string" ? req.body.name.trim():"";
        const document= typeof req.body?.document ==="string" ? req.body.document.trim():"";
        if(!name || !document){
            res.status(400).json({
                error:"name_and_document_are_required"
            });
            return;
        }
        const id=crypto.randomUUID();

        const result= await pool.query<PassRow>(
            `INSERT INTO passes(id,name,document,status)
            VALUES($1, $2, $3, 'ACTIVE')
            RETURNING id, name, document, issued_at, status`,[id, name, document]
        );
        const row=result.rows[0];
        if(!row){
            throw new Error("Created pass was not returned");
        }
        const pass= mapPass(row);

        const publicInfoUrl=`${publicUrl}/info/${encodeURIComponent(pass.id)}`;
        const qrCode= await QRCode.toBuffer(
            publicInfoUrl,{
                type:"png",
                errorCorrectionLevel:"M",
                width: 500,
                margin:2
            }
        );

        const location=`${publicUrl}/passes/${encodeURIComponent(pass.id)}`;
        res.status(201).setHeader("Content-Type","image/png").setHeader("Location",location).send(qrCode);

    }catch(error){
        next(error);
    }
});
app.use("/passes",apiRouter);