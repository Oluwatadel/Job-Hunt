import React, {useRef,useState} from "react";
import {Feather, WandSparkles, History, Fingerprint, ArrowUpRight, ArrowRight, Plus, Copy, Download, Check, X, AlignLeft, ShieldCheck, RotateCcw, LoaderCircle, FileText, Leaf} from "lucide-react";
import {Button} from "../components/Button";
import {Textarea} from "../components/Textarea";
import styles from "./_index.module.css";
type Revision={id:string;date:string;input:string;output:string;tone:string;strength:string};
const example="In today's fast-paced world, the importance of maintaining a healthy work-life balance cannot be overstated. It is essential to recognise that productivity is not solely determined by the number of hours spent working, but rather by the quality and focus of the work undertaken.\n\nFurthermore, organisations that prioritise employee wellbeing are likely to benefit from increased engagement and improved retention. By fostering a supportive environment, businesses can create a culture in which individuals feel valued and motivated to contribute their best work.";
const count=(s:string)=>s.trim()?s.trim().split(/\s+/).length:0;
function saved():Revision[]{try{const a=JSON.parse(localStorage.getItem("ownvoice-history")||"[]");return Array.isArray(a)?a.filter(r=>r&&typeof r.input==="string"&&typeof r.output==="string"&&typeof r.date==="string").slice(0,10):[]}catch{return []}}
export default function Editor(){
 const [input,setInput]=useState(""); const [output,setOutput]=useState(""); const [resultInput,setResultInput]=useState("");
 const [tone,setTone]=useState("Natural"); const [strength,setStrength]=useState("Balanced"); const [voice,setVoice]=useState("");
 const [panel,setPanel]=useState<"editor"|"voice"|"history">("editor"); const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState(""); const [warnings,setWarnings]=useState<string[]>([]); const [diff,setDiff]=useState(false);
 const [history,setHistory]=useState<Revision[]>(saved);const [remember,setRemember]=useState(false);const [cooldown,setCooldown]=useState(0);
 const inputRef=useRef<HTMLTextAreaElement>(null); const uploadRef=useRef<HTMLInputElement>(null);
 const dirty=!!output&&input!==resultInput;
 const words=count(input); const originalWords=new Set(resultInput.toLowerCase().match(/[\p{L}\p{N}']+/gu)||[]);
 const changed=output.split(/(\s+)/).filter(w=>w.trim()&&!originalWords.has(w.toLowerCase().replace(/[^\p{L}\p{N}']/gu,""))).length;
 async function rewrite(){
  setMessage("");if(words<10){setMessage("Add at least 10 words to get a useful rewrite.");return;}setBusy(true);
  const original=input;
  try{
   const response=await fetch("/_api/rewrite",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:original,tone,strength,voice}),signal:AbortSignal.timeout(150000)});
   const data=await response.json();
   if(!response.ok){if(data.code==="OUT_OF_CREDITS"){setMessage("Rewriting is temporarily unavailable.");return;}if(response.status===429){setCooldown(Date.now()+60000);setTimeout(()=>setCooldown(0),60000);}throw new Error(data.error||"The rewrite failed. Please try again.");}
   setOutput(data.text);setResultInput(original);setWarnings(data.warnings||[]);setDiff(false);
   const item={id:crypto.randomUUID(),date:new Date().toISOString(),input:original,output:data.text,tone,strength};
   setHistory(h=>{const next=[item,...h].slice(0,10);if(remember)try{localStorage.setItem("ownvoice-history",JSON.stringify(next))}catch{setMessage("Rewrite ready. This browser could not save the history.");}return next;});
  }catch(e){setMessage(e instanceof Error?e.message:"Something went wrong.");}finally{setBusy(false);}
 }
 function newDraft(){setInput("");setOutput("");setWarnings([]);setMessage("");setPanel("editor");inputRef.current?.focus();}
 function download(){const url=URL.createObjectURL(new Blob([output],{type:"text/plain;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download="ownvoice-draft.txt";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async function copy(){try{await navigator.clipboard.writeText(output);setMessage("Copied to clipboard.");}catch{setMessage("Clipboard access is unavailable. Select the revised text to copy it.");}}
 return <div className={styles.app}>
  <aside className={styles.sidebar}>
   <a className={styles.logo} href="/" aria-label="OwnVoice home"><span><Feather size={22}/></span>ownvoice<span className={styles.logoDot}>.</span></a>
   <div className={styles.workspaceLabel}>YOUR WRITING SPACE</div>
   <nav aria-label="Workspace">
    {[["editor",WandSparkles,"Humaniser"],["voice",Fingerprint,"My voice"],["history",History,"Recent drafts"]].map(([key,Icon,label])=>{const I=Icon as typeof Feather;return <Button key={String(key)} variant="ghost" className={panel===key?styles.navActive:styles.navButton} onClick={()=>setPanel(key as typeof panel)}><I size={18}/>{String(label)}{key==="editor"&&<span className={styles.tinyBadge}>AI</span>}</Button>})}
   </nav>
   <div className={styles.sidebarNote}><Leaf size={23}/><h3>A little more you.</h3><p>Your ideas deserve a voice that feels like your own.</p><span>Thoughtful words. Real meaning.</span></div>
   <div className={styles.profile}><span>Y</span><div>Your workspace<small>Private preview</small></div></div>
  </aside>
  <main className={styles.main}>
   <header className={styles.topbar}><span>Workspace <span className={styles.slash}>/</span> {panel==="editor"?"Humaniser":panel==="voice"?"My voice":"Recent drafts"}</span><span className={styles.previewBadge}><span/> EARLY ACCESS</span></header>
   <div className={styles.content}>
   <div className={styles.headingRow}><div><div className={styles.eyebrow}>LESS GENERIC. MORE YOU.</div><h1>Good ideas. <em>Your voice.</em></h1><p>Turn a stiff first draft into writing that feels like you.</p></div><Button variant="outline" onClick={newDraft} disabled={busy}><Plus/>New draft</Button></div>
   {panel==="voice"&&<section className={styles.settingsPanel}><Fingerprint/><h2>Give your words a familiar voice.</h2><p>Add 100–300 words you wrote yourself. We use the rhythm and style as a reference, without copying its facts into your draft. Your sample is kept in this tab and sent with each rewrite.</p><Textarea aria-label="Your writing sample" value={voice} maxLength={6000} onChange={e=>setVoice(e.target.value)} placeholder="Paste a sample of your own writing…" className={styles.voiceInput}/><div className={styles.panelActions}><span>{count(voice)} words · optional</span><Button onClick={()=>setPanel("editor")}>Use this voice <ArrowRight/></Button></div></section>}
   {panel==="history"&&<section className={styles.settingsPanel}><History/><h2>A second look, whenever you need it.</h2><p>Revisions stay in this tab. Save on this device only if you want them to survive a refresh.</p><Button variant={remember?"secondary":"outline"} onClick={()=>{const next=!remember;setRemember(next);try{if(next)localStorage.setItem("ownvoice-history",JSON.stringify(history));else localStorage.removeItem("ownvoice-history")}catch{setMessage("Device storage is unavailable.");}}}>{remember?<Check/>:<Plus/>}{remember?"Saving on this device":"Save history on this device"}</Button><div className={styles.historyList}>{history.length?history.map(r=><article key={r.id}><FileText/><div><strong>{r.input.slice(0,65)}…</strong><small>{new Date(r.date).toLocaleString()} · {r.tone} · {r.strength}</small></div><Button variant="outline" onClick={()=>{setInput(r.input);setOutput(r.output);setResultInput(r.input);setWarnings([]);setPanel("editor");}}>Open <ArrowUpRight/></Button></article>):<p>No revisions yet. Your next rewrite will appear here.</p>}</div><Button variant="ghost" disabled={!history.length} onClick={()=>{setHistory([]);try{localStorage.removeItem("ownvoice-history")}catch{}}}>Clear all history</Button></section>}
   {panel==="editor"&&<>
    <section className={styles.editor} aria-label="Writing editor">
     <div className={styles.toolbar}><div className={styles.tones} aria-label="Writing tone">{["Natural","Academic","Professional","Casual"].map(t=><Button key={t} size="sm" variant="ghost" className={tone===t?styles.toneActive:styles.tone} disabled={busy} aria-pressed={tone===t} onClick={()=>setTone(t)}>{t==="Natural"&&<Leaf size={14}/>} {t}</Button>)}</div><Button size="sm" variant="ghost" onClick={()=>setPanel("voice")}><Fingerprint/>{voice?"Voice added":"Add my voice"}<Plus size={13}/></Button></div>
     <div className={styles.columns}>
      <div className={styles.inputPane}><div className={styles.paneHead}><span><span className={styles.step}>01</span> YOUR DRAFT</span><Button variant="ghost" size="icon-sm" aria-label="Clear draft" disabled={!input||busy} onClick={()=>{setInput("");setMessage("");}}><X/></Button></div>
       <Textarea ref={inputRef} variant="clear" disableResize disabled={busy} maxLength={18000} aria-label="Original draft" value={input} onChange={e=>setInput(e.target.value)} placeholder={"Your next great piece starts here.\n\nPaste a draft, a paragraph, or an idea that needs a little room to breathe."} className={styles.draft}/>
       {!input&&<div className={styles.emptyActions}><Button variant="outline" size="sm" onClick={()=>setInput(example)}>Try an example <ArrowUpRight/></Button><Button variant="ghost" size="sm" onClick={()=>uploadRef.current?.click()}><FileText/>Import .txt</Button><input hidden type="file" accept=".txt,text/plain" ref={uploadRef} onChange={async e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>72000){setMessage("Please choose a text file under 72 KB.");return;}const text=await file.text();if(text.length>18000){setMessage("Please import at most 18,000 characters.");return;}setInput(text);e.target.value="";}}/></div>}
       <div className={styles.paneFoot}><span>{words.toLocaleString()} words <span>·</span> {input.length.toLocaleString()} / 18,000 characters</span><span>English</span></div>
      </div>
      <div className={styles.outputPane} aria-busy={busy}><div className={styles.paneHead}><span><span className={styles.step}>02</span> YOUR REFINED DRAFT</span>{output&&<Button size="sm" variant="ghost" onClick={()=>setDiff(!diff)} aria-pressed={diff}><AlignLeft/>{diff?"Plain text":"Highlight new words"}</Button>}</div>
       {output?<div className={styles.output}>{diff?output.split(/(\s+)/).map((w,i)=>originalWords.has(w.toLowerCase().replace(/[^\p{L}\p{N}']/gu,""))||!w.trim()?w:<mark key={i}>{w}</mark>):output}</div>:<div className={styles.outputEmpty}><div className={busy?styles.spinning:styles.flower}>{busy?<LoaderCircle size={32}/>:<Feather size={32}/>}</div><h2>{busy?"Finding the right words…":"A fresh take, still you."}</h2><p>{busy?"Refining your rhythm while keeping your ideas intact.":"Your revised draft will appear here. Same meaning. A more natural flow."}</p><span>YOUR IDEAS STAY AT THE CENTRE</span></div>}
       <div className={styles.paneFoot}><span>{output?count(output)+" words":"Ready when you are"}{output&&" · "+changed+" new word occurrences"}</span><div><Button size="icon-sm" variant="ghost" aria-label="Copy revised draft" disabled={!output||busy} onClick={copy}><Copy/></Button><Button size="icon-sm" variant="ghost" aria-label="Download revised draft" disabled={!output||busy} onClick={download}><Download/></Button></div></div>
      </div>
     </div>
     <div className={styles.bottomBar}><div><span className={styles.controlLabel}>REWRITE STRENGTH</span><div className={styles.strengths}>{["Light","Balanced","Thorough"].map(s=><Button key={s} size="sm" variant="ghost" aria-pressed={strength===s} className={strength===s?styles.strengthActive:""} disabled={busy} onClick={()=>setStrength(s)}>{s}</Button>)}</div></div><Button size="lg" className={styles.generate} disabled={busy||words<10||cooldown>Date.now()} onClick={rewrite}>{busy?<LoaderCircle className={styles.spinning}/>:<WandSparkles/>}{busy?"Refining your draft…":cooldown>Date.now()?"Please wait a minute":"Humanise my draft"}{!busy&&<ArrowRight/>}</Button></div>
    </section>
    {dirty&&<p className={styles.notice}>You changed your original draft. Run a new rewrite to update the result.</p>}
    {warnings.map((w,i)=><p className={styles.notice} key={i}>{w}</p>)}
    <div className={styles.benefits}><div><ShieldCheck/><span><strong>Meaning comes first</strong><small>Protected citations, quotations and numbers</small></span></div><div><Fingerprint/><span><strong>Your voice, amplified</strong><small>Style that follows your own writing sample</small></span></div><div><RotateCcw/><span><strong>Every word is yours to review</strong><small>Compare, refine and take the final say</small></span></div></div>
    <div className={styles.editorialNote}><span>THE OWNVOICE APPROACH</span><p>Better writing starts with something worth saying.<br/>We help you say it <em>like yourself.</em></p><Feather size={50}/></div>
   </>}
   {message&&<p className={styles.notice} role="status">{message}</p>}
   <footer className={styles.footer}><span>Made for thoughtful writing.</span><span>AI-assisted editing · Review before use · No detector guarantees</span></footer>
   </div>
  </main>
 </div>
}
