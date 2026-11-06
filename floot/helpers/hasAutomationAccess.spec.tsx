import { hasAutomationAccess as allowed } from "./hasAutomationAccess";
describe("Automation payment gate",()=>{
 const now=new Date("2026-10-29T12:00:00Z"),future=new Date("2026-11-29T12:00:00Z"),past=new Date("2026-09-29T12:00:00Z");
 const base={userId:2,ownerId:1,now};
 it("keeps new social/password users locked",()=>expect(allowed(base)).toBeFalse());
 it("rejects active subscriptions with no confirmed payment",()=>expect(allowed({...base,billing:{status:"active",periodEnd:future,paidThrough:null}})).toBeFalse());
 it("rejects a trial even with future dates",()=>expect(allowed({...base,billing:{status:"trialing",periodEnd:future,paidThrough:future}})).toBeFalse());
 it("requires the paid invoice period to be current",()=>expect(allowed({...base,billing:{status:"active",periodEnd:future,paidThrough:past}})).toBeFalse());
 it("unlocks a confirmed current paid period",()=>expect(allowed({...base,billing:{status:"active",periodEnd:future,paidThrough:future}})).toBeTrue());
 it("keeps past-due and canceled accounts locked",()=>{for(const status of ["past_due","canceled","unpaid","incomplete"])expect(allowed({...base,billing:{status,periodEnd:future,paidThrough:future}})).toBeFalse();});
 it("honors owner and current admin grants",()=>{expect(allowed({...base,userId:1})).toBeTrue();expect(allowed({...base,accessUntil:future})).toBeTrue();expect(allowed({...base,accessUntil:past})).toBeFalse();});
 it("blocks suspended accounts including free grants",()=>expect(allowed({...base,disabled:true,accessUntil:future})).toBeFalse());
});
