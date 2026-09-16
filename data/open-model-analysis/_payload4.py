
import json, glob, os, re, ast, collections
BASE = r"C:/Users/Maaz/Desktop/open-models figures"
DIRS = {"internvl3_5-8b":"InternVL3_5-8B/internvl3_5-8b", "deepseek-vl2-small":"deepseek-vl2-small/deepseek-vl2-small"}
NUMPAT = re.compile(r"[-+]?\d*\.?\d+"); WORD = re.compile(r"[a-z0-9]")
def to_num(s):
    try: return float(s)
    except Exception: return None
def norm(s):
    s = str(s).lower(); s = re.sub(r"[\"'\x60{}\[\]()]", " ", s); s = re.sub(r"\s+", " ", s).strip()
    return re.sub(r"[.]+$", "", s).strip()
def bmatch(hay, part):
    if not part: return False
    if hay == part: return True
    st = 0
    while True:
        i = hay.find(part, st)
        if i < 0: return False
        b = hay[i-1] if i > 0 else ""; a = hay[i+len(part)] if i+len(part) < len(hay) else ""
        if not WORD.match(b or " ") and not WORD.match(a or " "): return True
        st = i+1
def nums(s): return [v for v in (to_num(t) for t in NUMPAT.findall(str(s))) if v is not None]
def num_close(a,b): return abs(a-b) <= max(0.05, 0.01*abs(b))
def committed(pred):
    t=str(pred)
    m=list(re.finditer(r"FINAL ANSWER\s*[:\-]\s*([^\n]+)", t, re.I))
    if m: return m[-1].group(1)
    m=list(re.finditer(r"(?:the\s+)?(?:correct\s+)?(?:final\s+)?answer\s*(?:is|:)\s*([^\n]+)", t, re.I))
    if m: return m[-1].group(1)
    return t
def flatten(v,out):
    if isinstance(v,dict):
        for vv in v.values(): flatten(vv,out)
    elif isinstance(v,(list,tuple)):
        if v and all(isinstance(x,(list,tuple)) for x in v): out.append(("rank",[[str(y).strip() for y in g] for g in v]))
        else:
            for vv in v: flatten(vv,out)
    elif isinstance(v,bool): out.append(("text","yes" if v else "no"))
    elif isinstance(v,(int,float)): out.append(("num",float(v)))
    else:
        sv=str(v).strip()
        if re.fullmatch(r"[-+]?\d+(\.\d+)?", sv): out.append(("num",float(sv)))
        elif ">" in sv or "=" in sv: out.append(("rank",[[x.strip() for x in re.split(r"[>=]+", sv)]]))
        else: out.append(("text",sv))
def gt_parts(gt):
    s=str(gt).strip(); parsed=None
    if s[:1] in "{[":
        try: parsed=ast.literal_eval(s)
        except Exception: parsed=None
    if isinstance(parsed,(dict,list)):
        o=[]; flatten(parsed,o); return o,"structured"
    if ";" in s: return [("text",p) for p in s.split(";")],"multipart"
    n=to_num(s); return ([("num",n)] if n is not None else [("text",s)]),"plain"
def rank_ok(pred,groups):
    hay=norm(pred); order=[]
    for g in groups:
        for tok in g:
            i=hay.find(norm(tok))
            if i<0: return False
            order.append((i,tuple(g)))
    order.sort(); seen=[]
    for _,g in order:
        if not seen or seen[-1]!=g: seen.append(g)
    return seen==[tuple(g) for g in groups]
def grade(gt,pred):
    if pred is None or str(pred).strip()=="" : return 0,0.0,0
    parts,kind=gt_parts(gt)
    if not parts: return 0,0.0,0
    hay=norm(pred); seg=committed(pred); sn=nums(seg); pool=sn if sn else nums(pred)
    hits=0
    for typ,val in parts:
        if typ=="num":
            if any(num_close(x,val) for x in pool): hits+=1
        elif typ=="rank":
            if rank_ok(pred,val): hits+=1
        else:
            if bmatch(hay,norm(val)): hits+=1
    return (1 if hits==len(parts) else 0), hits/len(parts), len(parts)

FAMS = {
 'Plane Geometry':['nested_squares','nested_triangles','nested_hexagons','line_intersection','angle_estimation'],
 'Solid Geometry':['cube_net','cube_structure','combination3d','orthographic','polyhedron','depth_height'],
 'Transformational':['rotation_matching','symmetry_pattern','fold_punch','combination','embedded_figures','overlap_circles'],
 'Physical & Mechanical':['physical_stability','gear_train','fbd','projectile_motion','laser_mirror','clock_reading','gauge_reading'],
 'Topological':['surface_topology','route','hex_pathfinding'],
 'Projective':['occluded_pattern','shadow_inference'],
 'Analytic':['coordinate_geometry','compass_bearing'],
 'Optical':['optical_illusion','impossible_object'],
 'Inductive':['rpm']}
key=lambda d: d.replace("_dataset_3000","").replace("_dataset_1000","")
base=json.load(open(os.path.join(BASE,"_baseline.json"),encoding="utf-8"))
audit=json.load(open(os.path.join(BASE,"_audit.json"),encoding="utf-8"))

out={"families":list(FAMS),"models":[],"domains":[],"audit":{},"integrity":{}}
dom_store={}
for mid,label in zip(DIRS,["InternVL3.5-8B","DeepSeek-VL2-Small"]):
    T=collections.Counter(); doms={}; cls=collections.Counter(); ex=collections.defaultdict(list); bands=collections.Counter()
    for path in sorted(glob.glob(os.path.join(DIRS[mid],"*.jsonl"))):
        full=os.path.basename(path).replace(".jsonl",""); dom=key(full)
        st=collections.Counter(); L=collections.defaultdict(collections.Counter)
        for line in open(path,encoding="utf-8",errors="replace"):
            line=line.strip()
            if not line: continue
            r=json.loads(line); l=int(r["level"]); gt=r.get("groundtruth"); pred=r.get("prediction")
            as_ok=r.get("correct") is True
            ok,frac,nparts=grade(gt,pred)
            st["n"]+=1; st["as"]+=as_ok; st["acc"]+=ok; st["partial"]+=frac
            e=L[str(l)]; e["n"]+=1; e["as"]+=as_ok; e["acc"]+=ok; e["partial"]+=frac
            if as_ok and not ok:
                st["over"]+=1
                parts,kind=gt_parts(gt); hay=norm(pred)
                g=to_num(gt); pn=nums(pred); segn=nums(committed(pred))
                if any(t=="text" and (norm(v) in hay) and not bmatch(hay,norm(v)) for t,v in parts):
                    c="text fragment match"
                elif g is not None and any(num_close(x,g) for x in pn) and not any(num_close(x,g) for x in (segn if segn else pn)):
                    c="right number, wrong final answer"
                elif g is not None and pn:
                    best=min(pn,key=lambda x: abs(x-g)); rl=abs(best-g)/abs(g) if g else 9
                    c="near-miss number accepted"
                    bands["<=2%" if rl<=0.02 else "<=5%" if rl<=0.05 else "<=10%" if rl<=0.10 else ">10%"]+=1
                else:
                    c="other"
                cls[c]+=1
                if len(ex[c])<3: ex[c].append([dom,l,str(gt)[:34],str(pred)[:52]])
            elif (not as_ok) and ok:
                st["under"]+=1
                parts,kind=gt_parts(gt)
                c="other"
                if kind=="structured": c="structured answer recovered"
                elif kind=="multipart": c="multi-part answer fully matched"
                elif kind=="plain": c="text/number matched after normalisation"
                cls["under: "+c]+=1
                if len(ex["under: "+c])<3: ex["under: "+c].append([dom,l,str(gt)[:34],str(pred)[:52]])
        st["levels"]={k:dict(v) for k,v in L.items()}
        doms[dom]=dict(st)
        for k,v in st.items():
            if isinstance(v,(int,float)) and not isinstance(v,bool): T[k]+=v
    dom_store[mid]=(doms,T,cls,dict(ex),dict(bands))

for mid,label in zip(DIRS,["InternVL3.5-8B","DeepSeek-VL2-Small"]):
    doms,T,cls,ex,bands=dom_store[mid]
    pf=sum(audit["models"][mid]["domains"][f].get("parse_fail",0) for f in audit["models"][mid]["domains"])
    lv=[]
    for i in "12345":
        n=a=p=0
        for d in doms.values():
            e=d["levels"][i]; n+=e["n"]; a+=e["acc"]; p+=e["partial"]
        lv.append({"n":n,"acc":a,"partial":round(p,1)})
    out["models"].append({"id":mid,"label":label,"n":T["n"],"acc":T["acc"],"as":T["as"],
        "over":T["over"],"under":T["under"],"partial":round(T["partial"],1),"pf":pf,"levels":lv})

for d in sorted(dom_store[list(DIRS)[0]][0].keys()):
    full=[k for k in base["domains"] if key(k)==d][0]
    b=base["domains"][full]
    per=[]
    for mid in DIRS:
        v=dom_store[mid][0][d]
        levels=[{"n":v["levels"][i]["n"],"acc":v["levels"][i]["acc"],"as":v["levels"][i]["as"],
                 "partial":round(v["levels"][i]["partial"],1)} for i in "12345"]
        per.append({"n":v["n"],"acc":v["acc"],"as":v["as"],"over":v.get("over",0),"under":v.get("under",0),"partial":round(v["partial"],1),
                    "pf":audit["models"][mid]["domains"][full].get("parse_fail",0),"levels":levels})
    out["domains"].append({"k":d,"f":next(i for i,f in enumerate(FAMS) if d in FAMS[f]),"per":per,
        "base":{"o":b["base_overall"],"l":[x["base"] for x in b["levels"]],"top":b["top_overall"]},
        "const":[i for i in range(5) if b["levels"][i]["base"]>=0.9]})

# family + constant-level stats
fb=[]
for fn,members in FAMS.items():
    n=0; num=0; den=0
    for m in members:
        x=next(z for z in out["domains"] if z["k"]==m)
        for i in range(5):
            nn=x["per"][0]["levels"][i]["n"]; num+=x["base"]["l"][i]*nn; den+=nn
    o=sum(next(z for z in out["domains"] if z["k"]==m)["base"]["o"]*next(z for z in out["domains"] if z["k"]==m)["per"][0]["n"] for m in members)
    n=sum(next(z for z in out["domains"] if z["k"]==m)["per"][0]["n"] for m in members)
    fb.append({"o":o/n,"l":[0]*5})
    # per-level oracle within the family
    for i in range(5):
        nn=sum(next(z for z in out["domains"] if z["k"]==m)["per"][0]["levels"][i]["n"] for m in members)
        c=sum(next(z for z in out["domains"] if z["k"]==m)["base"]["l"][i]*next(z for z in out["domains"] if z["k"]==m)["per"][0]["levels"][i]["n"] for m in members)
        fb[-1]["l"][i]=c/nn if nn else 0
out["family_base"]=fb

# zero-levels under the FINAL grader
zero=[]
for x in out["domains"]:
    for i in range(5):
        a,b=x["per"][0]["levels"][i],x["per"][1]["levels"][i]
        if a["as"]==0 and b["as"]==0:                      # harness scored 0 for BOTH models
            if a["acc"] or b["acc"]: cat="Structured ground truth — recovered by the grader"
            elif a["partial"] or b["partial"]: cat="Multi-part ground truth — one part answered"
            else: cat="Genuinely wrong on both models"
            zero.append({"dom":x["k"],"lv":i+1,"n":a["n"],"cat":cat,"ivl":a["acc"],"ds":b["acc"],
                         "ivl_p":round(a["partial"]/a["n"]*100,1),"ds_p":round(b["partial"]/b["n"]*100,1)})
zero.sort(key=lambda z:(z["cat"],z["dom"],z["lv"]))
out["audit"]["zeroLevels"]=zero
out["audit"]["classes"]={mid:dom_store[mid][2] for mid in DIRS}
out["audit"]["examples"]={mid:dom_store[mid][3] for mid in DIRS}
out["audit"]["bands"]={mid:dom_store[mid][4] for mid in DIRS}
out["audit"]["movers"]=sorted([{"k":x["k"],"ivl":round(x["per"][0]["as"]/x["per"][0]["n"]*100,1),"ivl2":round(x["per"][0]["acc"]/x["per"][0]["n"]*100,1),
    "ds":round(x["per"][1]["as"]/x["per"][1]["n"]*100,1),"ds2":round(x["per"][1]["acc"]/x["per"][1]["n"]*100,1)} for x in out["domains"]],
    key=lambda z: (z["ivl2"]-z["ivl"])+(z["ds2"]-z["ds"]))[::-1][:5]
out["audit"]["droppers"]=sorted([{"k":x["k"],"ivl":round(x["per"][0]["as"]/x["per"][0]["n"]*100,1),"ivl2":round(x["per"][0]["acc"]/x["per"][0]["n"]*100,1),
    "ds":round(x["per"][1]["as"]/x["per"][1]["n"]*100,1),"ds2":round(x["per"][1]["acc"]/x["per"][1]["n"]*100,1)} for x in out["domains"]],
    key=lambda z: (z["ivl2"]-z["ivl"])+(z["ds2"]-z["ds"]))[:5]
imgs=sum(v["images_seen"] for v in audit["models"][list(DIRS)[0]]["domains"].values())
out["integrity"]={"imagesPerModel":imgs,"questionsPerModel":out["models"][0]["n"],
  "oracleOverall":sum(x["base"]["o"]*x["per"][0]["n"] for x in out["domains"])/sum(x["per"][0]["n"] for x in out["domains"]),
  "constantLevels":[{"dom":x["k"],"lv":i+1,"top":x["base"]["top"],"base":x["base"]["l"][i]} for x in out["domains"] for i in x["const"]],
  "dupIds":0,"errorRecords":0,"nominal":3000,"evalPerDomain":1500}

bad=[k for d in out["domains"] for p in d["per"] for k in ("n","acc","as","over","under","partial","pf") if not isinstance(p.get(k),(int,float))]
assert not bad, bad[:6]
assert sum(d["per"][0]["n"] for d in out["domains"])==out["models"][0]["n"]
assert sum(d["per"][0]["acc"] for d in out["domains"])==out["models"][0]["acc"]
assert sum(d["per"][1]["acc"] for d in out["domains"])==out["models"][1]["acc"]
json.dump(out,open(os.path.join(BASE,"_page_data_v4.json"),"w",encoding="utf-8"))
print("validated v4 |", os.path.getsize(os.path.join(BASE,"_page_data_v4.json")), "bytes")
for m in out["models"]:
    print(m["label"],"FINAL",round(m["acc"]/m["n"]*100,2),"| harness",round(m["as"]/m["n"]*100,2),
          "| over",m["over"],"under",m["under"],"| partial",round(m["partial"]/m["n"]*100,2),
          "| agreement",round((m["n"]-m["over"]-m["under"])/m["n"]*100,2))
print("\nover-credit classes:")
for mid in DIRS: print("  ",mid,out["audit"]["classes"][mid])
print("\nnear-miss bands:")
for mid in DIRS: print("  ",mid,out["audit"]["bands"][mid])
print("\nzero-levels:",len(out["audit"]["zeroLevels"]))
print("movers:",[(z["k"],z["ivl"],z["ivl2"]) for z in out["audit"]["movers"]])
print("droppers:",[(z["k"],z["ivl"],z["ivl2"]) for z in out["audit"]["droppers"]])
