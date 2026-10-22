import express from 'express';
import cors from 'cors';
import {auth, requiredScopes} from 'express-oauth2-jwt-bearer';

const app=express();
app.use(cors());

const authServer='';
