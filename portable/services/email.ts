import nodemailer from 'nodemailer';
import { required } from './config';
export async function sendEmail(params:any){
 try { const transport=nodemailer.createTransport(required('SMTP_URL'));const result=await transport.sendMail({...params,from:required('MAIL_FROM')});return {ok:true,messageId:result.messageId}; }
 catch {return {ok:false,error:{code:'EMAIL_UNAVAILABLE',message:'Email delivery is not configured or failed.'}};}
}
