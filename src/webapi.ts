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

const config={
    authRequired:false,
    idpLogout: true,
    secret: process.env.SECRET,
    baseURL:`http://${hostname}:${port}`,
    clientID:process.env.CLIENT_ID,
    issuerBaseURL:'',
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

app.get("/passes/:id")

app.post("/passes",requiredScopes("create:passes"),
async(req,res)=>{
    const accessToken=req.auth?.token;
    if(!accessToken){
        res.status(401).json({
            error:"missing_token"
        });
        return;
    }
    try{
        const name= typeof req.body?.name==="string" ? req.body.name.trim():"";
        const document= typeof req.body?.document==="string" ? req.body.document.trim():"";
        if(!name||!document){
            res.status(400).json({
                error:"name_and_document_are_required"
            });
            return;
        }
        const id=crypto.randomUUID();
        
        
    }
})