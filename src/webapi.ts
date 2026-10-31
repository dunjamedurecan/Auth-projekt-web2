import express, {NextFunction, Request, Response} from 'express';
import cors from 'cors';
import { auth as apiAuth, requiredScopes } from "express-oauth2-jwt-bearer"
import oidc from 'express-openid-connect';
import QRCode from "qrcode";
import dotenv from 'dotenv'
import {randomUUID} from 'crypto';
import {Pool} from 'pg'
import { renderPage } from './views.ts';

const {auth, requiresAuth}=oidc;

dotenv.config()

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Nedostaje environment varijabla: ${name}`
    );
  }

  return value;
}

//Konfiguracija
const port=Number(process.env.PORT ?? 3000);
const hostname=process.env.HOSTNAME ?? "0.0.0.0";
const publicUrl=process.env.PUBLIC_URL?.replace(/\/+$/,"");
const authServer = requiredEnv(
  "AUTH0_ISSUER_BASE_URL"
).replace(/\/+$/, "");

const authAudience = requiredEnv(
  "AUTH0_AUDIENCE"
);

//postavljanje baze podataka
const pool =new Pool({
    user:process.env.DB_USER,
    host: process.env.DB_HOST,
    database: 'projekt1_baza',
    password:process.env.DB_PASSWORD,
    port:5432,
    ssl:{rejectUnauthorized:false}
})

const app=express();
app.set('trust proxy',1);
app.use(cors());
app.use(express.json());



//OIDC
const config={
    authRequired:false,
    idpLogout: true,
    secret: requiredEnv("OIDC_SESSION_SECRET"),
    baseURL:publicUrl,
    clientID:requiredEnv("CLIENT_ID"),
    issuerBaseURL:authServer,
    clientSecret:requiredEnv("CLIENT_SECRET"),
    routes:{
        logout: false as const
    },
    authorizationParams:{
        response_type:'code',
        scope: "openid profile email"
    },
};
app.use(auth(config));


//OAuth2(machine-to-machine)
const checkJwt = apiAuth({
  issuerBaseURL: authServer,
  audience: authAudience
});

//pomoćne funkcije

type PassStatus="ACTIVE"|"CANCELLED";

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

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isLoggedIn(req: Request):boolean{
    return Boolean(
        req.oidc && req.oidc.isAuthenticated()
    );
}

function escapeHtml(value:string):string{
    return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g,'&#39;')
    .replace(/\{/g,'&#123;')
    .replace(/\}/g,'&#125;');
}

//datum - ispis format
function formatDate(date:Date):string{
    return date.toISOString().replace("T"," ").replace(".000Z","UTC");
}

function mapPass(row:PassRow):Pass{
    return{
        id: row.id,
        name:row.name,
        document: row.document,
        issuedAt:row.issued_at,
        status:row.status
    };
}

function passToJson(pass:Pass){
    return{
        id: pass.id,
        name:pass.name,
        document: pass.document,
        issuedAt:pass.issuedAt,
        status: pass.status
    };
}
function getNavigation(req: Request):string{
    if(isLoggedIn(req)){
        return `
        <a href="/manage">Propusnice</a>
        <form method="post" action="/logout" style="display: inline;">
            <button type="submit">Odjava</button>
        </form>`;
    }
    return `<a href="/login">Prijava</a>`;
}

//javne stranice

app.post('/logout',(req,res)=>res.oidc.logout());

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
            <a href="/manage">Otvori upravljanje propusnicama</a>`
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


app.get("/info/:id",async (req,res,next)=>{
    try{
        const id=String(req.params.id);
        let row: PassRow|undefined;
        if(UUID_RE.test(id)){
            const result= await pool.query<PassRow>(
            `SELECT id, name, document, issued_at, status
            FROM passes
            WHERE id=$1`,[id]);
            row=result.rows[0];
        }
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
                ID: escapeHtml(pass.id),
                NAME: escapeHtml(pass.name),
                DOCUMENT: escapeHtml(pass.document),
                ISSUED_AT: formatDate(pass.issuedAt)
            }, getNavigation(req)
        );
        res.send(html);
    }catch(error){
        next(error);
    }
});

//sučelje za prijavljene korisnike /manage - pregled propusnica,itd.
app.get("/manage",requiresAuth(),
async (req,res,next)=>{
    try{
        const result=await pool.query<PassRow>(
            `SELECT id, name, document, issued_at, status
            FROM passes
            ORDER BY issued_at DESC`
        );
        const passes=result.rows.map(mapPass);
        const passesContent=
            passes.length===0
            ? `<p>Trenutno nema izdanih propusnica.</p>`
            : `<table>
                    <thead>
                        <tr>
                            <th>Ime</th>
                            <th>Dokument</th>
                            <th>Status</th>
                            <th>Vrijeme izdavanja</th>
                            <th>Akcije</th>
                        </tr>
                    </thead>
                    <tbody>${passes
                        .map((pass)=>{
                            const statusClass=pass.status==='ACTIVE'?'active':'cancelled';
                            const id=encodeURIComponent(pass.id);
                            return `<tr>
                                <td>${escapeHtml(pass.name)}</td>
                                <td>${escapeHtml(pass.document)}</td>
                                <td><span class="${statusClass}">${pass.status}</span></td>
                                <td>${formatDate(pass.issuedAt)}</td>
                                <td>
                                    <a href="/info/${id}">Javna stranica</a>
                                    ${
                                        pass.status=='ACTIVE'
                                        ? `<form method="post" action="/manage/${id}/cancel" style="display:inline;">
                                                <button class="warning" type="submit">Poništi</button>
                                            </form>`
                                        :''
                                    }
                                    <form method="post" action="/manage/${id}/delete" style="display:inline;" onsubmit="return confirm('Obrisati propusnicu?');">
                                        <button class="danger" type="submit">Obriši</button>
                                    </form>
                                </td>
                            </tr>`;
                        })
                        .join('')}
                        </tbody>
                    </table>`;
        const html= await renderPage("Propusnice","passes.html",{PASSES_CONTENT: passesContent},getNavigation(req));
        res.send(html);

    }catch(error){
        next(error);
    }
});

app.post("/manage/:id/cancel",requiresAuth(), async (req, res, next)=>{
    try{
        const result=await pool.query(`UPDATE passes 
            SET status='CANCELLED' 
            WHERE id=$1 AND status='ACTIVE'`,[req.params.id]);
        if(result.rowCount!==1){
            res.status(404).send("Propusnica nije pronađena ili je već poništena.");
            return;
        }
        res.redirect("/manage");
    }catch(error){
        next(error);
    }
});

app.post("/manage/:id/delete",requiresAuth(), async (req,res,next)=>{
    try{
        const result= await pool.query(`DELETE FROM passes
            WHERE id=$1`,[req.params.id]);
        if (result.rowCount!==1){
            res.status(404).send("Propusnica nije pronađena");
            return;
        }
        res.redirect("/manage");
    }catch(error){
        next(error);
    }
});
//API zaštićen OAuth2
const apiRouter=express.Router();
apiRouter.use(checkJwt); //401 za nedostajući/nevaljajući token

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
        const id=randomUUID();

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

//error handler
app.use((err:any,req:Request,res:Response,_next:NextFunction)=>{
    const status=Number(err?.status ?? err?.statusCode ?? 500);
    if (status>=500){
        console.error(err);
    }
    if(req.path.startsWith('/passes')){
        res.status(status).json({error:status>=500 ? 'server_error':(err.message ?? 'error')});
        return;
    }
    res.status(status).send(status>=500 ? 'Greška na poslužitelju.':(err.message ?? 'Greška.'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});