# -*- coding: utf-8 -*-
"""Fetches all Constructa UTM data and builds an analysis report (.md + .pdf)."""
import urllib.request, json, statistics, re, os
from collections import Counter, defaultdict
from datetime import datetime

EP = "https://script.google.com/macros/s/AKfycbxgWlc_0ZkVdtNGznRm1pCRmKZes18Yrm_XzgDknByKcRfiHxfNh6lfgM0EWIi2SKc0sw/exec"
def get(q=""):
    with urllib.request.urlopen(EP + q, timeout=60) as r:
        return json.load(r)

visits = get("")
events = get("?events=1")
landing = get("?landing=1")
links  = get("?links=1")

# Exclude DIRECT / untagged traffic entirely - this report covers only "other"
# (tagged: social / campaign / referral / landing-click-through) users.
def is_direct(sv):
    sv=(sv or "").strip().lower()
    return sv in ("","(direct)","direct","(not set)")
visits  = [v for v in visits  if not is_direct(v.get("source"))]
events  = [e for e in events  if not is_direct(e.get("source"))]
landing = [x for x in landing if not is_direct(x.get("source"))]

def norm_src(s):
    s = (s or "").strip()
    low = s.lower()
    if low in ("", "(direct)", "direct", "(not set)"): return "(direct)"
    aliases = {"youtube":"YouTube","email":"Email","instagram":"Instagram","facebook":"Facebook",
               "whatsapp":"WhatsApp","google":"Google","linkedin":"LinkedIn","twitter":"Twitter",
               "localhost":"localhost","constructa-page.atumx.in":"Landing page"}
    return aliases.get(low, s)

def day(ts):
    ts = str(ts or "")
    m = re.match(r"(\d{4}-\d{2}-\d{2})", ts)
    return m.group(1) if m else None

def pct(a, b): return (100.0*a/b) if b else 0.0

# ── Blocks (rendered to both markdown + pdf) ─────────────────────────────────
B = []
def h1(t): B.append(("h1", t))
def h2(t): B.append(("h2", t))
def p(t):  B.append(("p", t))
def li(t): B.append(("li", t))
def tbl(headers, rows): B.append(("tbl", (headers, rows)))
def sp():  B.append(("sp", None))

# ── Derived sets ─────────────────────────────────────────────────────────────
V, E, L = visits, events, landing
n_v = len(V)
ev_by = Counter(e.get("event") for e in E)
def sids_for(name): return {e.get("sid") for e in E if e.get("event")==name and e.get("sid")}
uniq_sid_any = {e.get("sid") for e in E if e.get("sid")}

tagged = sum(1 for v in V if v.get("tagged"))
direct = n_v - tagged
src_v = Counter(norm_src(v.get("source")) for v in V)
camp_v = Counter((v.get("campaign") or "(not set)") for v in V)
ref_v = Counter(v.get("ref") for v in V if v.get("ref"))
dev_v = Counter((v.get("device_type") or "unknown") for v in V)
ctry_v = Counter((v.get("country") or "unknown") for v in V)
ret = Counter(("returning" if (v.get("is_returning_visitor") in ("returning",True)) else "new") for v in V)
durs = [v.get("session_duration") for v in V if isinstance(v.get("session_duration"),(int,float)) and v.get("session_duration")>0]
days = Counter(d for v in V if (d:=day(v.get("ts"))))
refr = Counter((v.get("referrer") or "").split("/")[2] if (v.get("referrer") or "").startswith("http") else "(none)" for v in V)

date_min = min(days) if days else "?"
date_max = max(days) if days else "?"

# Tutorial funnel
maxstep = {}
step_id = {}
for e in E:
    if e.get("event")=="tutorial_step":
        try: x=json.loads(e.get("extra") or "{}")
        except: x={}
        st=int(x.get("step") or 0); sid=e.get("sid") or "anon"
        if st>0:
            maxstep[sid]=max(maxstep.get(sid,0),st)
            if x.get("step_id"): step_id[st]=x["step_id"]
n_started = len(sids_for("tutorial_started")) or len(maxstep)
n_completed = ev_by.get("tutorial_completed",0)
n_exited = ev_by.get("tutorial_exited",0)
maxN = max(maxstep.values()) if maxstep else 0

# Landing funnel
la_view = sum(1 for x in L if x.get("sub")=="view")
la_click = sum(1 for x in L if x.get("sub")=="early_access_click")
la_email = sum(1 for x in L if x.get("sub")=="email_submitted")
la_src = Counter(norm_src(x.get("source")) for x in L if x.get("sub")=="view")

# Leads
emails = set()
for x in L:
    if x.get("email"): emails.add(x["email"].strip().lower())
for e in E:
    if e.get("email"): emails.add(e["email"].strip().lower())
emails.discard("")

# Channel scorecard (by normalised source): visits + engagement from events
ev_src_sids = defaultdict(lambda: defaultdict(set))
for e in E:
    s = norm_src(e.get("source")); sid = e.get("sid")
    if sid: ev_src_sids[s][e.get("event")].add(sid)

# ═════════════════════════════ REPORT ═══════════════════════════════════════
h1("Constructa - UTM Analytics Report (tagged users only)")
p(f"Data window: {date_min} to {date_max}. Generated from the live collector.")
p("SCOPE: direct / untagged traffic is EXCLUDED. This report covers only 'other' "
  "users - those who arrived via a tagged source (social, campaign, referral, or a "
  "landing-page click-through).")
p(f"After excluding direct: {n_v} visits, {len(E)} in-app events, {len(L)} landing-page actions.")
sp()

# 1. Executive summary
h1("1. Executive summary")
app_loads = ev_by.get("app_loaded",0)
engaged = len(sids_for("code_run") | sids_for("sim_started"))
li(f"Tagged (non-direct) visits: {n_v}. Direct / untagged traffic is excluded from this report.")
li(f"App loads: {app_loads} | unique engaged sessions (ran code or a sim): {engaged}.")
li(f"Tutorial: {n_started} started -> {n_completed} completed ({pct(n_completed,n_started):.0f}%); {n_exited} explicitly exited.")
li(f"Landing page: {la_view} views -> {la_click} early-access clicks ({pct(la_click,la_view):.0f}%) -> {la_email} email submits ({pct(la_email,la_view):.0f}% of views).")
li(f"Leads captured (unique emails, app + landing): {len(emails)}.")
li(f"Audience is strongly desktop ({pct(dev_v.get('desktop',0),n_v):.0f}%) and India-led ({pct(ctry_v.get('India',0),n_v):.0f}% of visits).")
sp()

# 2. Acquisition
h1("2. Acquisition & traffic sources")
h2("Visits by source")
tbl(["Source","Visits","% of total"], [[s,c,f"{pct(c,n_v):.1f}%"] for s,c in src_v.most_common()])
h2("Campaigns")
tbl(["Campaign","Visits"], [[c,n] for c,n in camp_v.most_common(10)])
if ref_v:
    h2("Referrer / ambassador (ref=)")
    tbl(["ref","Visits"], [[c,n] for c,n in ref_v.most_common(10)])
h2("Top referring sites")
tbl(["Referrer host","Visits"], [[c,n] for c,n in refr.most_common(8)])
li(f"New vs returning: {ret.get('new',0)} new / {ret.get('returning',0)} returning.")
li(f"Instagram is the top channel ({src_v.get('Instagram',0)} visits); {src_v.get('Landing page',0)} "
   f"arrived from the landing page itself. (Direct / untagged traffic is excluded from this report.)")
sp()

# 3. Audience
h1("3. Audience")
h2("Device")
tbl(["Device","Visits","%"], [[s,c,f"{pct(c,n_v):.0f}%"] for s,c in dev_v.most_common()])
h2("Geography (top countries)")
tbl(["Country","Visits","%"], [[s,c,f"{pct(c,n_v):.0f}%"] for s,c in ctry_v.most_common(8)])
if durs:
    li(f"Session duration: median {statistics.median(durs):.0f}s, mean {statistics.mean(durs):.0f}s, "
       f"max {max(durs)}s (n={len(durs)} sessions with a recorded duration).")
li(f"Because the editor is desktop-only, the {dev_v.get('mobile',0)} mobile visits are the ones your "
   f"all-devices landing redirect now protects.")
sp()

# 4. Engagement
h1("4. In-app engagement")
rows=[]
for name in ["app_loaded","code_run","sim_started","project_saved","export_json","battle_started","arena_started"]:
    rows.append([name, ev_by.get(name,0), len(sids_for(name))])
tbl(["Event","Count","Unique sessions"], rows)
al = len(sids_for("app_loaded")) or app_loads
li(f"Of sessions that loaded the app, {pct(len(sids_for('code_run')),al):.0f}% ran code and "
   f"{pct(len(sids_for('sim_started')),al):.0f}% started a simulation.")
li(f"Projects saved: {ev_by.get('project_saved',0)} times by {len(sids_for('project_saved'))} sessions - "
   f"a strong intent signal.")
li(f"Export JSON ({ev_by.get('export_json',0)}) and Battle/Arena ({ev_by.get('battle_started',0)+ev_by.get('arena_started',0)}) "
   f"are barely used - either hard to find or low interest.")
sp()

# 5. Tutorial funnel
h1("5. Tutorial funnel - where users drop off")
li(f"{n_started} started, {n_completed} finished = {pct(n_completed,n_started):.0f}% completion. {n_exited} hit Exit.")
rows=[]; prev=n_started
STEP_LABELS={'debug-greet':'Meet Puppy','debug-open-sim':'Open Sim','debug-start-sim':'Start Sim',
 'debug-run-in-sim':'Run code (sim)','debug-observe-circle':'Spot the bug','debug-open-wiring':'Open Wiring',
 'debug-connect-left':'Fix wiring','debug-open-sim-2':'Back to Sim','debug-start-sim-2':'Start Sim (retest)',
 'debug-run-2':'Run code (retest)','debug-victory':'Fixed!','debug-find-learn':'Product Tour',
 'mission-start':'Intro','add-chassis':'Add chassis','flatten-chassis':'Flatten chassis','add-motors':'Add motors',
 'bond-motor':'Bond motors','add-wheels':'Add wheels','attach-both':'Pick attach','attach-wheels':'Attach wheels',
 'fix-wheel-y':'Fix wheel Y','add-brain':'Add brain','wire-all':'Wire motors','open-code':'Open Code',
 'run-code':'Run code','drive-it':'Drive it','mission-done':'Finish'}
for n in range(1, maxN+1):
    reached = sum(1 for s in maxstep if maxstep[s]>=n)
    drop = prev-reached; prev=reached
    label = STEP_LABELS.get(step_id.get(n,""), step_id.get(n,"") or f"Step {n}")
    rows.append([f"{n}. {label}", reached, f"{pct(reached,n_started):.0f}%", (f"-{drop}" if drop>0 else "")])
tbl(["Step","Reached","% of starters","Drop"], rows)
sp()

# 6. Landing performance
h1("6. Landing-page performance")
li(f"Funnel: {la_view} views -> {la_click} early-access clicks ({pct(la_click,la_view):.0f}%) -> {la_email} emails ({pct(la_email,la_view):.0f}% of views).")
h2("Landing views by source")
tbl(["Source","Views"], [[s,c] for s,c in la_src.most_common(8)])
sp()

# 7. Channel scorecard
h1("7. Channel scorecard (quality, not just volume)")
rows=[]
for s,c in src_v.most_common():
    d = ev_src_sids.get(s,{})
    def u(ev): return len(d.get(ev,set()))
    rows.append([s, c, u("code_run"), u("sim_started"), u("project_saved"), u("tutorial_completed")])
tbl(["Source","Visits","Ran code","Sim","Saved","Tut done"], rows)
li("Read across each row: high visits with near-zero engagement = low-quality traffic; "
   "smaller sources with saves/completions = your best-fit users.")
sp()

# 8. Campaign links
h1("8. Saved campaign links")
if links:
    tbl(["Saved","Label","Source","Campaign","Ref"],
        [[str(x.get('saved'))[:10], x.get('label') or '-', x.get('source') or '-', x.get('campaign') or '-', x.get('ref') or '-'] for x in links])
else:
    p("No saved links.")
sp()

# 9. Leads
h1("9. Leads captured")
li(f"Unique emails: {len(emails)} (landing {la_email} + in-app {ev_by.get('email_submitted',0)}, de-duplicated).")
p("Full list (also in the sheet):")
for em in sorted(emails): li(em)
sp()

# 10. Data quality
h1("10. Data-quality notes")
sid_v = sum(1 for v in V if v.get("sid"))
li(f"Visit-level user id (sid) is present on only {sid_v}/{n_v} visits - older rows predate the fix, so "
   f"per-user VISIT linkage is limited historically (in-app EVENTS are better: {len(uniq_sid_any)} distinct sessions).")
li(f"{ctry_v.get('unknown',0)} visits have no country (geo lookup failed/blocked); "
   f"{dev_v.get('unknown',0)} have no device.")
li("Going forward the reload/sid fix and the visits-sid column will close these gaps.")
sp()

# 11. Recommendations
h1("11. Recommendations")
li(f"Fix the tutorial leak: only {pct(n_completed,n_started):.0f}% finish. The drop table above shows the exact "
   f"step where most quit - shorten or clarify that step first.")
li(f"Landing converts well ({pct(la_email,la_view):.0f}% view->email) - send MORE traffic to it; Instagram is "
   f"already your best named channel, so double down there.")
li("Keep tagging every link (the 6 saved-links pattern) so every channel stays measurable - note this report "
   "already excludes the large untagged 'direct' bucket that otherwise hides your channel performance.")
li(f"Desktop is {pct(dev_v.get('desktop',0),n_v):.0f}% of traffic; keep the mobile->landing redirect and the "
   f"'open on desktop' nudge you just shipped.")
li("Surface Export/Battle/Arena better (or drop from the top-line) - they're almost unused.")

# ── Render markdown ──────────────────────────────────────────────────────────
def md_table(h,r):
    out=["| "+" | ".join(map(str,h))+" |","|"+"|".join(["---"]*len(h))+"|"]
    for row in r: out.append("| "+" | ".join(map(str,row))+" |")
    return "\n".join(out)
md=[]
for kind,val in B:
    if kind=="h1": md.append(f"\n# {val}\n")
    elif kind=="h2": md.append(f"\n## {val}\n")
    elif kind=="p": md.append(val+"\n")
    elif kind=="li": md.append(f"- {val}")
    elif kind=="tbl": md.append(md_table(*val)+"\n")
    elif kind=="sp": md.append("")
os.makedirs("reports",exist_ok=True)
open("reports/utm-report.md","w",encoding="utf-8").write("\n".join(md))

# ── Render PDF (fpdf2, latin-1 safe) ─────────────────────────────────────────
from fpdf import FPDF
def s(x):
    x=str(x)
    for a,b in [("—","-"),("–","-"),("→","->"),("’","'"),("‘","'"),
                ("“",'"'),("”",'"'),("（","("),("）",")"),("…","...")]:
        x=x.replace(a,b)
    return x.encode("latin-1","replace").decode("latin-1")
pdf=FPDF(); pdf.set_auto_page_break(True,15); pdf.add_page(); pdf.set_margins(15,15,15)
W=180
for kind,val in B:
    if kind=="h1":
        pdf.ln(2); pdf.set_font("Helvetica","B",15); pdf.set_text_color(20,20,60)
        pdf.multi_cell(W,8,s(val)); pdf.set_text_color(0,0,0); pdf.ln(1)
    elif kind=="h2":
        pdf.ln(1); pdf.set_font("Helvetica","B",12); pdf.multi_cell(W,7,s(val)); pdf.ln(0.5)
    elif kind=="p":
        pdf.set_font("Helvetica","",10.5); pdf.multi_cell(W,5.5,s(val)); pdf.ln(0.5)
    elif kind=="li":
        pdf.set_font("Helvetica","",10.5); pdf.multi_cell(W,5.5,s("  - "+str(val)))
    elif kind=="sp":
        pdf.ln(2)
    elif kind=="tbl":
        headers,rows=val; ncol=len(headers)
        widths=[W*0.42]+[ (W*0.58)/(ncol-1) ]*(ncol-1) if ncol>1 else [W]
        pdf.set_font("Helvetica","B",9); pdf.set_fill_color(235,238,248)
        for i,hh in enumerate(headers): pdf.cell(widths[i],6,s(hh),border=1,fill=True)
        pdf.ln(6); pdf.set_font("Helvetica","",8.5)
        for row in rows:
            # simple wrap guard: truncate long cells
            for i,c in enumerate(row):
                txt=s(c)
                if len(txt)>60 and i==0: txt=txt[:58]+".."
                pdf.cell(widths[i],5.5,txt,border=1)
            pdf.ln(5.5)
        pdf.ln(1)
pdf.output("reports/utm-report.pdf")
print("WROTE reports/utm-report.md and reports/utm-report.pdf")
print("md chars:", len("\n".join(md)))
