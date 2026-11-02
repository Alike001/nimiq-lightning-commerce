import {createHmac,timingSafeEqual} from 'node:crypto';

// Only explicitly denied permissions are classed as definite rejection.
// An ambiguous wallet error must NEVER unlock a payment attempt automatically.
export function classifyWalletOutcome(error) {
  const type=String(error?.type||'UNKNOWN').slice(0,64).replace(/[^A-Z_0-9]/g,'') || 'UNKNOWN';
  const code=(typeof error?.code==='number' && Number.isSafeInteger(error.code))?error.code:null;
  return {outcome:type==='PERMISSION_DENIED'?'APPROVAL_REJECTED':'UNKNOWN',type,code};
}
export function validTxHash(value){return typeof value==='string' && /^[a-fA-F0-9]{64}$/.test(value)}
export function validateAttemptReport(report){
  if(!report || report.phase!=='result' || !['SUBMITTED','APPROVAL_REJECTED','UNKNOWN'].includes(report.outcome)) return false;
  if(report.outcome==='SUBMITTED' && !validTxHash(report.hash)) return false;
  if(report.hash!==undefined && report.hash!==null && !validTxHash(report.hash)) return false;
  if(report.swapId!==undefined && report.swapId!==null && (typeof report.swapId!=='string'||report.swapId.length>160))return false;
  if(report.errorType!==undefined && (typeof report.errorType!=='string'|| !/^[A-Z0-9_]{1,64}$/.test(report.errorType)))return false;
  if(report.errorCode!==undefined && report.errorCode!==null && !(Number.isSafeInteger(report.errorCode)))return false;
  return true;
}
export function verifyBtcpaySignature(rawBody, header, secret) {
  if(!secret || typeof header!=='string'||!/^sha256=[a-f0-9]{64}$/.test(header))return false;
  const expected=Buffer.from(createHmac('sha256',secret).update(rawBody).digest('hex'),'hex');
  const received=Buffer.from(header.slice(7),'hex');
  return expected.length===received.length && timingSafeEqual(expected,received);
}
export function validateBtcpayEvent(evt,storeId){
  return !!evt && evt.storeId===storeId && typeof evt.invoiceId==='string' && /^[A-Za-z0-9_-]{5,150}$/.test(evt.invoiceId)
    && typeof evt.deliveryId==='string' && /^[A-Za-z0-9_-]{1,160}$/.test(evt.deliveryId)
    && typeof evt.type==='string' && /^Invoice[A-Za-z]+$/.test(evt.type);
}
