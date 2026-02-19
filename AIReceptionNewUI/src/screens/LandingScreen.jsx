import { useEffect, useRef } from "react";
import PricingPackages from "../components/PricingPackages";

const STYLE_BLOCK = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#020510;--bg2:#040918;--navy:#060c20;
  --blue:#1659ff;--blue2:#4d87ff;--cyan:#00e5ff;--teal:#00c4b4;
  --violet:#6e3aff;--violet2:#9b6dff;
  --white:#f0f4ff;--w70:rgba(240,244,255,0.7);--w40:rgba(240,244,255,0.4);
  --w15:rgba(240,244,255,0.15);--w08:rgba(240,244,255,0.08);--w04:rgba(240,244,255,0.04);
  --glass:rgba(255,255,255,0.04);--gborder:rgba(255,255,255,0.1)
}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--white);font-family:'DM Sans',sans-serif;overflow-x:hidden;cursor:none}

#cdot{position:fixed;left:0;top:0;width:8px;height:8px;background:var(--cyan);border-radius:50% !important;pointer-events:none;z-index:10000;transform:translate(-50%,-50%);box-shadow:0 0 12px var(--cyan),0 0 24px var(--cyan);transition:width .25s,height .25s,background .25s}
#cring{position:fixed;left:0;top:0;width:40px;height:40px;border:1.5px solid rgba(0,229,255,.45);border-radius:50% !important;pointer-events:none;z-index:9999;transform:translate(-50%,-50%);transition:width .3s,height .3s,border-color .3s}
#cdot.h{width:14px;height:14px;background:var(--violet2)}
#cring.h{width:60px;height:60px;border-color:rgba(110,58,255,.5)}

#pc{position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.5}

body::after{content:'';position:fixed;inset:0;z-index:1;pointer-events:none;
  background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");
  opacity:.3}

.hero{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:140px 24px 80px;position:relative;z-index:2;overflow:hidden}
.hmesh{position:absolute;inset:0;z-index:0;
  background:radial-gradient(ellipse 90% 70% at 50% -10%,rgba(22,89,255,.22) 0%,transparent 60%),
             radial-gradient(ellipse 60% 50% at 85% 60%,rgba(110,58,255,.13) 0%,transparent 60%),
             radial-gradient(ellipse 50% 40% at 15% 70%,rgba(0,229,255,.09) 0%,transparent 60%);
  animation:meshP 10s ease-in-out infinite}
@keyframes meshP{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.7;transform:scale(1.03)}}
.hgrid{position:absolute;inset:0;z-index:0;
  background:linear-gradient(rgba(255,255,255,.023) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.023) 1px,transparent 1px);
  background-size:80px 80px;mask-image:radial-gradient(ellipse 80% 80% at 50% 0%,black 30%,transparent 80%)}
.hring{position:absolute;border-radius:50%;border:1px solid rgba(22,89,255,.14);animation:rP 6s ease-in-out infinite;top:50%;left:50%;transform:translate(-50%,-50%)}
.hr1{width:500px;height:500px;animation-delay:0s}
.hr2{width:760px;height:760px;animation-delay:-2s;border-color:rgba(0,229,255,.07)}
.hr3{width:1060px;height:1060px;animation-delay:-4s;border-color:rgba(110,58,255,.05)}
@keyframes rP{0%,100%{opacity:.6;transform:translate(-50%,-50%) scale(1)}50%{opacity:1;transform:translate(-50%,-50%) scale(1.03)}}

.hcontent{position:relative;z-index:3;max-width:860px}

.hpill{display:inline-flex;align-items:center;gap:10px;padding:8px 20px 8px 10px;border-radius:100px;background:rgba(22,89,255,.1);border:1px solid rgba(22,89,255,.3);font-size:.77rem;font-weight:600;margin-bottom:36px;animation:sd .9s cubic-bezier(.16,1,.3,1) forwards;opacity:0;color:var(--w70)}
.pdot{width:28px;height:28px;background:linear-gradient(135deg,var(--blue),var(--cyan));border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.75rem;box-shadow:0 0 12px rgba(0,229,255,.5)}
.hpill em{color:var(--cyan);font-style:normal;font-weight:700}

.hh1{font-family:'Bricolage Grotesque',sans-serif;font-size:clamp(3rem,7.5vw,6.5rem);font-weight:800;line-height:1;letter-spacing:-.04em;margin-bottom:28px;animation:sd .9s .15s cubic-bezier(.16,1,.3,1) forwards;opacity:0}
.hh1 .w2{display:block;background:linear-gradient(90deg,var(--blue2) 0%,var(--cyan) 40%,var(--violet2) 80%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;background-size:200% 100%;animation:shTx 4s linear infinite,sd .9s .15s cubic-bezier(.16,1,.3,1) forwards}
@keyframes shTx{0%{background-position:0 0}100%{background-position:200% 0}}

.hsub{font-size:clamp(1rem,1.8vw,1.2rem);color:var(--w70);max-width:560px;margin:0 auto 48px;line-height:1.75;font-weight:400;animation:sd .9s .25s cubic-bezier(.16,1,.3,1) forwards;opacity:0}
.hbtns{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin-bottom:20px;animation:sd .9s .35s cubic-bezier(.16,1,.3,1) forwards;opacity:0}
.bprim{display:inline-flex;align-items:center;gap:10px;padding:16px 36px;border-radius:14px;font-family:'Bricolage Grotesque',sans-serif;font-size:1rem;font-weight:700;color:white;text-decoration:none;background:linear-gradient(135deg,var(--blue) 0%,#0a44cc 100%);box-shadow:0 0 0 1px rgba(255,255,255,.12) inset,0 8px 40px rgba(22,89,255,.5),0 2px 8px rgba(0,0,0,.4);position:relative;overflow:hidden;transition:transform .2s,box-shadow .2s;border:0}
.bprim::after{content:'';position:absolute;top:0;left:-100%;width:60%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.15),transparent);animation:bSh 3s 2s ease-in-out infinite}
@keyframes bSh{0%{left:-100%}100%{left:200%}}
.bprim:hover{transform:translateY(-2px) scale(1.02);box-shadow:0 0 0 1px rgba(255,255,255,.15) inset,0 16px 60px rgba(22,89,255,.6)}
.bsec{display:inline-flex;align-items:center;gap:10px;padding:16px 36px;border-radius:14px;font-size:1rem;font-weight:600;color:var(--white);text-decoration:none;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(12px);transition:background .2s,border-color .2s,transform .2s}
.bsec:hover{background:rgba(255,255,255,.09);border-color:rgba(255,255,255,.25);transform:translateY(-1px)}

.trust{font-size:.77rem;color:var(--w40);display:flex;align-items:center;gap:10px;justify-content:center;margin-bottom:60px;animation:sd .9s .45s cubic-bezier(.16,1,.3,1) forwards;opacity:0}
.tsep{width:3px;height:3px;border-radius:50%;background:var(--w15)}

.sband{display:inline-flex;gap:0;background:rgba(255,255,255,.04);border:1px solid var(--w08);border-radius:18px;overflow:hidden;animation:sd .9s .55s cubic-bezier(.16,1,.3,1) forwards;opacity:0;margin-bottom:64px;backdrop-filter:blur(20px)}
.scell{padding:18px 32px;text-align:center;position:relative}
.scell:not(:last-child)::after{content:'';position:absolute;right:0;top:18%;bottom:18%;width:1px;background:var(--w08)}
.snum{font-family:'Bricolage Grotesque',sans-serif;font-size:1.6rem;font-weight:800;letter-spacing:-.04em;background:linear-gradient(135deg,var(--white),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.slbl{font-size:.72rem;color:var(--w40);font-weight:500;margin-top:2px}

.hvwrap{position:relative;z-index:3;animation:su 1s .65s cubic-bezier(.16,1,.3,1) forwards;opacity:0;perspective:1200px;max-width:920px;margin:0 auto;padding:0 24px}
.hdash{transform:rotateX(8deg);transform-style:preserve-3d;transition:transform .6s cubic-bezier(.16,1,.3,1)}
.dshell{background:rgba(6,12,32,.88);border:1px solid rgba(255,255,255,.12);border-radius:24px;overflow:hidden;box-shadow:0 0 0 1px rgba(255,255,255,.05) inset,0 60px 120px rgba(0,0,0,.7),0 0 100px rgba(22,89,255,.13),0 0 200px rgba(0,229,255,.06);backdrop-filter:blur(20px)}
.dchrome{background:rgba(255,255,255,.03);border-bottom:1px solid var(--w08);padding:14px 20px;display:flex;align-items:center;gap:10px}
.cdots{display:flex;gap:7px}
.cdot2{width:11px;height:11px;border-radius:50%}
.cdr{background:#ff5f57}.cdy{background:#febc2e}.cdg{background:#28c840}
.curl{flex:1;background:var(--w04);border-radius:8px;height:26px;margin:0 16px;display:flex;align-items:center;justify-content:center;font-size:.68rem;color:var(--w40);gap:5px}
.dbody{display:grid;grid-template-columns:210px 1fr 190px;gap:0;min-height:275px}

.dsidebar{background:rgba(255,255,255,.02);border-right:1px solid var(--w08);padding:14px;display:flex;flex-direction:column;gap:3px}
.sni{display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:8px;font-size:.7rem;font-weight:600;color:var(--w40)}
.sni.act{background:rgba(22,89,255,.15);color:var(--white);border:1px solid rgba(22,89,255,.22)}
.sico{width:22px;height:22px;border-radius:6px;background:var(--w08);display:flex;align-items:center;justify-content:center;font-size:.68rem}
.sico.act{background:linear-gradient(135deg,var(--blue),var(--cyan))}

.dmain{padding:14px;display:flex;flex-direction:column;gap:10px}
.dseclbl{font-size:.62rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--w40);margin-bottom:6px}

.lccard{background:linear-gradient(135deg,rgba(0,229,255,.08),rgba(22,89,255,.06));border:1px solid rgba(0,229,255,.2);border-radius:12px;padding:12px;display:flex;align-items:center;gap:10px}
.cava{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--blue),var(--cyan));display:flex;align-items:center;justify-content:center;font-size:.77rem;font-weight:700;flex-shrink:0;box-shadow:0 0 14px rgba(0,229,255,.3)}
.cname{font-size:.76rem;font-weight:700;margin-bottom:2px}
.csub{font-size:.65rem;color:var(--cyan);display:flex;align-items:center;gap:4px}
.lind{display:flex;align-items:center;gap:4px;background:rgba(0,229,255,.12);border-radius:100px;padding:3px 9px;font-size:.63rem;font-weight:700;color:var(--cyan)}
.ldot{width:5px;height:5px;border-radius:50%;background:var(--cyan);box-shadow:0 0 6px var(--cyan);animation:lP 1.5s infinite}
@keyframes lP{0%,100%{opacity:1}50%{opacity:.3}}
.wf{display:flex;align-items:center;gap:2.5px;height:26px;flex-shrink:0}
.wb{width:2.5px;border-radius:100px;background:var(--cyan);opacity:.8;animation:wv 1.1s ease-in-out infinite}
.wb:nth-child(1){animation-delay:0s;height:4px}.wb:nth-child(2){animation-delay:.1s;height:12px}.wb:nth-child(3){animation-delay:.2s;height:20px}.wb:nth-child(4){animation-delay:.3s;height:26px}.wb:nth-child(5){animation-delay:.4s;height:16px}.wb:nth-child(6){animation-delay:.3s;height:22px}.wb:nth-child(7){animation-delay:.2s;height:12px}.wb:nth-child(8){animation-delay:.1s;height:8px}
@keyframes wv{0%,100%{transform:scaleY(.3)}50%{transform:scaleY(1)}}

.mrow{display:flex;align-items:center;gap:9px;padding:8px;border-radius:10px;margin-bottom:3px}
.mrow.unr{background:rgba(22,89,255,.1)}
.mava{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.62rem;font-weight:700;flex-shrink:0}
.mbdy{flex:1;min-width:0}
.mname{font-size:.68rem;font-weight:700;display:flex;align-items:center;gap:4px}
.mprev{font-size:.62rem;color:var(--w40);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cpill{font-size:.52rem;font-weight:700;padding:1px 5px;border-radius:100px;flex-shrink:0}
.cpwa{background:rgba(37,211,102,.15);color:#25d366}.cpig{background:rgba(228,64,95,.15);color:#e4405f}.cpfb{background:rgba(24,119,242,.15);color:#1877f2}.cpem{background:rgba(110,58,255,.15);color:var(--violet2)}
.ubadge{width:15px;height:15px;border-radius:50%;background:var(--blue);font-size:.55rem;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}

.dtasks{background:rgba(255,255,255,.02);border-left:1px solid var(--w08);padding:14px}
.tcard{background:var(--w04);border:1px solid var(--w08);border-radius:10px;padding:9px 11px;margin-bottom:7px}
.tpri{width:5px;height:5px;border-radius:50%;flex-shrink:0}
.tr{background:#ff4d6a;box-shadow:0 0 5px #ff4d6a}.ty{background:#ffb800}.tg{background:#00e89a}
.ttitle{font-size:.65rem;font-weight:600;margin-bottom:3px}
.tassign{font-size:.58rem;color:var(--blue2);background:rgba(22,89,255,.12);border-radius:100px;padding:1px 6px;display:inline-block}

.fnotif{position:absolute;z-index:10;background:rgba(6,12,32,.93);border:1px solid rgba(0,229,255,.24);border-radius:14px;padding:11px 15px;display:flex;align-items:center;gap:9px;font-size:.73rem;font-weight:600;box-shadow:0 8px 40px rgba(0,0,0,.5),0 0 18px rgba(0,229,255,.12);backdrop-filter:blur(20px);animation:nF 4s ease-in-out infinite;white-space:nowrap}
.fnl{left:-90px;top:80px;animation-delay:0s}
.fnr{right:-90px;bottom:80px;animation-delay:-2s}
@keyframes nF{0%,100%{transform:translateY(0) rotate(-1deg)}50%{transform:translateY(-10px) rotate(1deg)}}
.nico{width:27px;height:27px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:.82rem}
.nt{background:rgba(0,229,255,.13)}.ng{background:rgba(0,232,154,.13)}
.live-demo-wrap{margin-top:22px;display:flex;justify-content:center;animation:su 1s .75s cubic-bezier(.16,1,.3,1) forwards;opacity:0}

@keyframes sd{from{opacity:0;transform:translateY(-18px)}to{opacity:1;transform:translateY(0)}}
@keyframes su{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}

.ticker{position:relative;z-index:2;border-top:1px solid var(--w08);border-bottom:1px solid var(--w08);background:rgba(255,255,255,.02);padding:18px 0;overflow:hidden}
.tlbl{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,var(--bg) 60%,transparent);z-index:2;display:flex;align-items:center;padding:0 40px;font-size:.7rem;font-weight:700;color:var(--w40);letter-spacing:.1em;text-transform:uppercase;white-space:nowrap}
.ttrack{display:flex;gap:0;animation:tick 22s linear infinite;width:max-content}
.titem{display:flex;align-items:center;gap:7px;padding:0 32px;font-size:.83rem;font-weight:600;color:var(--w70);white-space:nowrap;border-right:1px solid var(--w08)}
.titem em{color:var(--cyan);font-style:normal}
@keyframes tick{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}

section{position:relative;z-index:2}
.container{max-width:1160px;margin:0 auto;padding:0 32px}
.slabel{display:inline-flex;align-items:center;gap:8px;background:rgba(22,89,255,.1);border:1px solid rgba(22,89,255,.25);border-radius:100px;padding:5px 15px;font-size:.7rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--blue2);margin-bottom:18px}
.sldot{width:5px;height:5px;border-radius:50%;background:var(--cyan)}
.sh{font-family:'Bricolage Grotesque',sans-serif;font-size:clamp(2rem,4vw,3.2rem);font-weight:800;letter-spacing:-.03em;line-height:1.1}
.ssub{color:var(--w70);font-size:1rem;line-height:1.7;max-width:540px;margin-top:12px}
.gt{background:linear-gradient(90deg,var(--blue2),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.gt2{background:linear-gradient(90deg,var(--cyan),var(--violet2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.gt3{background:linear-gradient(90deg,#ff4d6a,#ff9a3c);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}

.sr2{opacity:0;transform:translateY(28px);transition:opacity .75s cubic-bezier(.16,1,.3,1),transform .75s cubic-bezier(.16,1,.3,1)}
.sr2.in{opacity:1;transform:none}
.d1{transition-delay:.1s}.d2{transition-delay:.2s}.d3{transition-delay:.3s}.d4{transition-delay:.4s}

.psec{padding:120px 0;background:var(--bg2);overflow:hidden}
.bgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:60px}
.bcard{background:var(--glass);border:1px solid var(--gborder);border-radius:20px;padding:34px 30px;position:relative;overflow:hidden;transition:transform .4s cubic-bezier(.16,1,.3,1);transform-style:preserve-3d}
.bcard::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:var(--btop,linear-gradient(90deg,transparent,rgba(255,80,80,.5),transparent))}
.bcard.sol::before{--btop:linear-gradient(90deg,transparent,rgba(0,229,255,.5),transparent)}
.bcnum{font-family:'Bricolage Grotesque',sans-serif;font-size:4rem;font-weight:800;letter-spacing:-.05em;opacity:.06;position:absolute;top:10px;right:18px;line-height:1}
.bcem{font-size:2.2rem;margin-bottom:18px;display:block}
.bch{font-family:'Bricolage Grotesque',sans-serif;font-size:1.12rem;font-weight:700;letter-spacing:-.02em;margin-bottom:9px}
.bcp{font-size:.87rem;color:var(--w70);line-height:1.65}

.sarr{display:flex;align-items:center;justify-content:center;padding:44px 0;flex-direction:column;gap:7px}
.apipe{width:1px;height:46px;background:linear-gradient(180deg,transparent,var(--blue),var(--cyan),transparent);position:relative}
.apipe::after{content:'';position:absolute;bottom:0;left:50%;transform:translateX(-50%);border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid var(--cyan)}
.atxt{font-size:.7rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--cyan)}

.fsec{padding:120px 0;background:var(--bg)}
.fgrid{display:grid;grid-template-columns:repeat(2,1fr);gap:20px;margin-top:60px}
.fcard{position:relative;border-radius:24px;overflow:hidden;background:rgba(255,255,255,.03);padding:38px;transition:transform .4s cubic-bezier(.16,1,.3,1);transform-style:preserve-3d}
.fcard::before{content:'';position:absolute;inset:0;border-radius:24px;padding:1px;background:var(--fbg,linear-gradient(135deg,rgba(0,229,255,.28),rgba(22,89,255,.13),rgba(110,58,255,.28)));-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);-webkit-mask-composite:xor;mask-composite:exclude;transition:opacity .3s}
.forb{position:absolute;width:200px;height:200px;border-radius:50%;filter:blur(60px);top:-60px;right:-60px;pointer-events:none;opacity:.28;transition:opacity .4s}
.fcard:hover .forb{opacity:.48}
.foc{background:var(--cyan)}.fob{background:var(--blue)}.fov{background:var(--violet)}.fot{background:var(--teal)}
.fico{width:50px;height:50px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:1.35rem;margin-bottom:22px}
.fic{background:rgba(0,229,255,.1);box-shadow:0 0 22px rgba(0,229,255,.13)}
.fib{background:rgba(22,89,255,.1);box-shadow:0 0 22px rgba(22,89,255,.18)}
.fiv{background:rgba(110,58,255,.12);box-shadow:0 0 22px rgba(110,58,255,.13)}
.fit{background:rgba(0,196,180,.1);box-shadow:0 0 22px rgba(0,196,180,.13)}
.ftit{font-family:'Bricolage Grotesque',sans-serif;font-size:1.25rem;font-weight:800;letter-spacing:-.02em;margin-bottom:5px}
.fbadge{font-size:.66rem;font-weight:700;letter-spacing:.06em;color:var(--cyan);text-transform:uppercase;background:rgba(0,229,255,.1);border-radius:100px;padding:3px 9px;margin-bottom:14px;display:inline-block}
.fbulls{list-style:none;margin-bottom:26px}
.fbulls li{display:flex;align-items:flex-start;gap:9px;font-size:.87rem;color:var(--w70);padding:6px 0;line-height:1.5}
.fbulls li .chk{color:var(--cyan);font-size:.73rem;margin-top:2px;flex-shrink:0}
.mui{background:rgba(0,0,0,.32);border:1px solid var(--w08);border-radius:14px;padding:13px;position:relative;overflow:hidden}
.mui::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--w15),transparent)}

.mcrow{display:flex;align-items:center;gap:9px;background:rgba(0,229,255,.06);border:1px solid rgba(0,229,255,.15);border-radius:11px;padding:9px 12px;margin-bottom:9px}
.mcava{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.62rem;font-weight:700}
.maai{background:linear-gradient(135deg,var(--blue),var(--cyan));box-shadow:0 0 10px rgba(0,229,255,.3)}
.mwsm{display:flex;gap:2px;align-items:center;height:16px;margin-left:auto}
.mwb{width:2px;border-radius:100px;background:var(--cyan);animation:wv 1s ease-in-out infinite}
.mwb:nth-child(2){animation-delay:.1s}.mwb:nth-child(3){animation-delay:.2s}.mwb:nth-child(4){animation-delay:.15s}
.mctag{background:rgba(22,89,255,.12);border:1px solid rgba(22,89,255,.2);border-radius:8px;padding:3px 9px;font-size:.63rem;color:var(--blue2);font-weight:600;display:inline-flex;align-items:center;gap:3px;margin-right:5px;margin-bottom:4px}

.imrow{display:flex;align-items:center;gap:7px;padding:7px 8px;border-radius:9px;margin-bottom:3px}
.imrow.act{background:rgba(22,89,255,.1)}
.imava{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.56rem;font-weight:700;flex-shrink:0}
.imtxt{flex:1;min-width:0}
.imn{font-size:.65rem;font-weight:700;display:flex;align-items:center;gap:3px}
.imm{font-size:.6rem;color:var(--w40);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.imt{font-size:.57rem;color:var(--w40);flex-shrink:0}

.howsec{padding:120px 0;background:var(--bg2);overflow:hidden}
.stps{display:flex;gap:0;margin-top:68px;position:relative}
.stps::before{content:'';position:absolute;top:37px;left:calc(16.66% + 16px);right:calc(16.66% + 16px);height:1px;background:linear-gradient(90deg,var(--blue),var(--cyan),var(--violet));opacity:.35}
.scol{flex:1;padding:0 20px;text-align:center;position:relative}
.snum2{width:74px;height:74px;border-radius:50%;background:var(--bg2);display:flex;align-items:center;justify-content:center;margin:0 auto 24px;position:relative;z-index:1}
.snum2::before{content:'';position:absolute;inset:-2px;border-radius:50%;background:linear-gradient(135deg,var(--blue),var(--cyan),var(--violet));z-index:-1}
.snum2::after{content:'';position:absolute;inset:0;border-radius:50%;background:var(--bg2);z-index:-1}
.sni2{font-family:'Bricolage Grotesque',sans-serif;font-size:1.5rem;font-weight:800;background:linear-gradient(135deg,var(--blue2),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;position:relative;z-index:2}
.scol h3{font-family:'Bricolage Grotesque',sans-serif;font-size:1.12rem;font-weight:700;letter-spacing:-.02em;margin-bottom:10px}
.scol p{font-size:.86rem;color:var(--w70);line-height:1.65}
.stags{display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-top:14px}
.stag{font-size:.63rem;font-weight:700;border-radius:100px;padding:4px 9px}
.stb{background:rgba(22,89,255,.15);color:var(--blue2);border:1px solid rgba(22,89,255,.2)}
.stc{background:rgba(0,229,255,.1);color:var(--cyan);border:1px solid rgba(0,229,255,.2)}
.stv{background:rgba(110,58,255,.12);color:var(--violet2);border:1px solid rgba(110,58,255,.2)}

.demsec{padding:100px 0;background:linear-gradient(180deg,var(--bg) 0%,rgba(22,89,255,.04) 50%,var(--bg) 100%);overflow:hidden}
.dphone{max-width:480px;margin:48px auto 0;background:rgba(6,12,32,.82);border:1px solid var(--w08);border-radius:28px;overflow:hidden;box-shadow:0 40px 100px rgba(0,0,0,.5),0 0 80px rgba(22,89,255,.08);backdrop-filter:blur(20px)}
.ptopbar{background:rgba(255,255,255,.03);border-bottom:1px solid var(--w08);padding:13px 18px;display:flex;align-items:center;gap:10px}
.pava{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,var(--blue),var(--cyan));display:flex;align-items:center;justify-content:center;font-size:.82rem;font-weight:700;box-shadow:0 0 10px rgba(0,229,255,.3)}
.pinfo{flex:1}
.pname{font-size:.83rem;font-weight:700}
.pstat{font-size:.68rem;color:var(--cyan);display:flex;align-items:center;gap:4px}
.pbody{padding:18px;min-height:310px;display:flex;flex-direction:column;gap:11px}
.cb{max-width:80%;border-radius:18px;padding:11px 15px;font-size:.85rem;line-height:1.55}
.cbc{background:var(--w08);color:var(--white);border-bottom-left-radius:4px;align-self:flex-start}
.cbai{background:linear-gradient(135deg,rgba(22,89,255,.24),rgba(0,229,255,.11));border:1px solid rgba(22,89,255,.3);border-bottom-right-radius:4px;align-self:flex-end;color:var(--white)}
.cbsys{align-self:center;background:rgba(0,229,255,.08);border:1px solid rgba(0,229,255,.2);border-radius:12px;color:var(--cyan);font-size:.76rem;font-weight:600;text-align:center;padding:9px 15px;max-width:95%}
.cb{opacity:0;animation:chIn .5s cubic-bezier(.16,1,.3,1) forwards}
.cb:nth-child(1){animation-delay:.3s}.cb:nth-child(2){animation-delay:1s}.cb:nth-child(3){animation-delay:1.8s}.cb:nth-child(4){animation-delay:2.5s}.cb:nth-child(5){animation-delay:3.3s}
@keyframes chIn{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}

.ucsec{padding:120px 0;background:var(--bg)}
.ucgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:60px}
.uccard{background:var(--glass);border:1px solid var(--gborder);border-radius:20px;padding:30px;position:relative;overflow:hidden;transition:transform .35s cubic-bezier(.16,1,.3,1),border-color .3s;transform-style:preserve-3d}
.uccard:hover{transform:translateY(-6px) rotateX(3deg);border-color:rgba(0,229,255,.25)}
.uccard::after{content:'';position:absolute;inset:0;border-radius:20px;background:radial-gradient(ellipse at 50% 0%,rgba(0,229,255,.05) 0%,transparent 60%);opacity:0;transition:opacity .3s}
.uccard:hover::after{opacity:1}
.ucem{font-size:2.3rem;margin-bottom:14px;display:block}
.uctit{font-family:'Bricolage Grotesque',sans-serif;font-size:1.02rem;font-weight:700;letter-spacing:-.02em;margin-bottom:14px}
.ucit{list-style:none}
.ucit li{font-size:.82rem;color:var(--w70);padding:4px 0;display:flex;align-items:flex-start;gap:7px;line-height:1.4}
.ucit li::before{content:'→';color:var(--blue2);font-size:.72rem;flex-shrink:0;margin-top:1px}

.intsec{padding:120px 0;background:var(--bg2)}
.intgrid{display:flex;flex-wrap:wrap;gap:14px;justify-content:center;margin-top:52px}
.intcard{display:flex;flex-direction:column;align-items:center;gap:9px;background:var(--glass);border:1px solid var(--gborder);border-radius:18px;padding:22px 26px;min-width:116px;transition:transform .3s,border-color .3s,box-shadow .3s}
.intcard:hover{transform:translateY(-6px);border-color:rgba(0,229,255,.28);box-shadow:0 16px 40px rgba(0,0,0,.3),0 0 28px rgba(0,229,255,.09)}
.intlogo{font-size:2rem}
.intname{font-size:.76rem;font-weight:600;color:var(--w70);text-align:center}
.intsoon{font-size:.58rem;font-weight:700;background:rgba(110,58,255,.14);color:var(--violet2);border:1px solid rgba(110,58,255,.23);border-radius:100px;padding:1px 7px}

.pricsec{padding:120px 0;background:var(--bg)}
.pric-packages{margin-top:56px}

.faqsec{padding:120px 0;background:var(--bg2)}
.faqlist{max-width:740px;margin:60px auto 0;display:flex;flex-direction:column;gap:11px}
.faqit{background:var(--glass);border:1px solid var(--gborder);border-radius:15px;overflow:hidden;transition:border-color .3s}
.faqit:hover{border-color:rgba(0,229,255,.18)}
.faqq{padding:20px 26px;font-size:.93rem;font-weight:700;display:flex;justify-content:space-between;align-items:center;gap:14px;cursor:pointer;user-select:none;letter-spacing:-.01em}
.faqq::after{content:'+';font-size:1.25rem;color:var(--blue2);flex-shrink:0;transition:transform .3s,color .3s}
.faqit.open .faqq::after{transform:rotate(45deg);color:var(--cyan)}
.faqa{max-height:0;overflow:hidden;transition:max-height .4s cubic-bezier(.16,1,.3,1),padding .3s;font-size:.86rem;color:var(--w70);line-height:1.7}
.faqit.open .faqa{max-height:180px;padding:0 26px 20px}

.ctasec{padding:140px 24px;text-align:center;position:relative;overflow:hidden}
.corb{position:absolute;border-radius:50%;filter:blur(100px);pointer-events:none}
.co1{width:600px;height:600px;background:rgba(22,89,255,.1);top:-200px;left:50%;transform:translateX(-50%)}
.co2{width:400px;height:400px;background:rgba(0,229,255,.07);bottom:-100px;left:20%}
.co3{width:350px;height:350px;background:rgba(110,58,255,.07);bottom:-100px;right:20%}
.ctain{position:relative;z-index:2;max-width:800px;margin:0 auto}
.ctah{font-family:'Bricolage Grotesque',sans-serif;font-size:clamp(2.5rem,6vw,5rem);font-weight:800;letter-spacing:-.04em;line-height:1.05;margin-bottom:22px}
.ctasub{font-size:1.08rem;color:var(--w70);margin-bottom:50px;line-height:1.6}
.ctabtns{display:flex;gap:14px;justify-content:center;flex-wrap:wrap}
.ctafn{margin-top:22px;font-size:.76rem;color:var(--w40)}

footer{background:var(--bg2);border-top:1px solid var(--w08);padding:42px 48px}
.ftgrid{max-width:1160px;margin:0 auto;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:22px}
.ftbrand{display:flex;align-items:center;justify-content:flex-start;gap:12px}
.ftlogo{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--white);font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:1.05rem}
.nmark{width:34px;height:34px;background:linear-gradient(135deg,var(--blue),var(--cyan));border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1rem;box-shadow:0 0 20px rgba(0,229,255,.4);position:relative;overflow:hidden}
.nmark::after{content:'';position:absolute;inset:0;background:linear-gradient(135deg,transparent 40%,rgba(255,255,255,.2))}
.ftsocials{display:flex;align-items:center;gap:8px}
.ftsocial{width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.04);border:1px solid var(--w08);color:var(--white);text-decoration:none;transition:transform .2s,border-color .2s,box-shadow .2s}
.ftsocial:hover{transform:translateY(-1px);border-color:rgba(0,229,255,.35);box-shadow:0 8px 24px rgba(0,0,0,.35),0 0 16px rgba(0,229,255,.15)}
.ftsocial svg{width:16px;height:16px;fill:currentColor}
.ftnav{display:flex;gap:26px;list-style:none;flex-wrap:wrap;justify-content:center;align-items:center}
.ftnav a{color:var(--w40);text-decoration:none;font-size:.83rem;font-weight:500;transition:color .2s}
.ftnav a:hover{color:var(--white)}
.ftcopy{font-size:.76rem;color:var(--w40);text-align:right;justify-self:end}

@media(max-width:960px){
  .bgrid,.fgrid,.ucgrid{grid-template-columns:1fr}
  .stps{flex-direction:column}.stps::before{display:none}
  .dbody{grid-template-columns:1fr}.dsidebar,.dtasks{display:none}
  .fnl,.fnr{display:none}
  footer{padding:30px 22px}
  .ftgrid{display:flex;flex-direction:column;align-items:center;text-align:center}
  .ftbrand{justify-content:center}
  .ftcopy{text-align:center;justify-self:auto}
}

@media(max-width:700px){
  .sband{display:grid;grid-template-columns:1fr 1fr}
  .scell:not(:last-child)::after{display:none}
}

@media (pointer: coarse){
  body{cursor:auto}
  #cdot,#cring{display:none}
}
`;

const FAQ_ITEMS = [
  {
    q: "Does SmartConnect4u work in the UK and Canada?",
    a: "Yes — we work in the UK, Canada, USA, Australia, and many more countries. Phone numbers are provisioned per country via Twilio. Multi-accent AI is supported everywhere."
  },
  {
    q: "Can I set business hours and call routing rules?",
    a: "Absolutely. Set custom hours, holiday schedules, and routing rules — send calls to voicemail, a team member, or a department based on time of day or call type."
  },
  {
    q: "Can the AI do warm transfers to a real person?",
    a: "Yes, on the Pro plan. The AI hands off a live call to a human team member with context so the caller does not repeat themselves."
  },
  {
    q: "Do you store call recordings?",
    a: "Yes. Calls can be recorded and stored securely for review and training, with notifications and controls aligned to compliance requirements."
  },
  {
    q: "How does multi-tenant security work?",
    a: "Each business is isolated with tenant-level partitioning, access controls, and role-based visibility so teams only see their own data."
  },
  {
    q: "What languages and accents does the AI support?",
    a: "50+ languages including English variants, French, Spanish, Hindi, Arabic, Mandarin, and more."
  }
];

export default function LandingScreen({ onTry, onLogin, onSelectPlan, onShowService, geoCountryCode, fxRates }) {
  const rootRef = useRef(null);
  const goToContactPage = () => {
    if (typeof window === "undefined") return;
    window.location.href = "/contact.html";
  };

  useEffect(() => {
    const id = "smartconnect4u-v2-fonts";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,700;12..96,800&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;1,9..40,300&display=swap";
    document.head.appendChild(link);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const cleanups = [];

    const cdot = document.getElementById("cdot");
    const cring = document.getElementById("cring");
    let mouseX = 0;
    let mouseY = 0;
    let ringX = 0;
    let ringY = 0;
    let cursorRaf = 0;
    const ringLerp = 0.22;

    const updateRing = () => {
      ringX += (mouseX - ringX) * ringLerp;
      ringY += (mouseY - ringY) * ringLerp;
      if (cring) {
        cring.style.left = `${ringX}px`;
        cring.style.top = `${ringY}px`;
      }
      cursorRaf = requestAnimationFrame(updateRing);
    };

    const onMove = (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      if (cdot) {
        cdot.style.left = `${mouseX}px`;
        cdot.style.top = `${mouseY}px`;
      }
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    cursorRaf = requestAnimationFrame(updateRing);
    cleanups.push(() => {
      document.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(cursorRaf);
    });

    const hoverTargets = Array.from(document.querySelectorAll("a,button,.faqq"));
    const onHoverIn = () => {
      cdot?.classList.add("h");
      cring?.classList.add("h");
    };
    const onHoverOut = () => {
      cdot?.classList.remove("h");
      cring?.classList.remove("h");
    };

    hoverTargets.forEach((el) => {
      el.addEventListener("mouseenter", onHoverIn);
      el.addEventListener("mouseleave", onHoverOut);
    });
    cleanups.push(() => {
      hoverTargets.forEach((el) => {
        el.removeEventListener("mouseenter", onHoverIn);
        el.removeEventListener("mouseleave", onHoverOut);
      });
    });

    const canvas = document.getElementById("pc");
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      let width = 0;
      let height = 0;
      let rafId = 0;

      const resize = () => {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
      };
      resize();
      window.addEventListener("resize", resize);

      class Pt {
        constructor() {
          this.reset();
        }

        reset() {
          this.x = Math.random() * width;
          this.y = Math.random() * height;
          this.sz = Math.random() * 1.4 + 0.3;
          this.vx = (Math.random() - 0.5) * 0.28;
          this.vy = (Math.random() - 0.5) * 0.28;
          this.op = Math.random() * 0.45 + 0.1;
          this.hue = Math.random() > 0.5 ? "200,229,255" : "100,150,255";
        }

        update() {
          this.x += this.vx;
          this.y += this.vy;
          if (this.x < 0 || this.x > width || this.y < 0 || this.y > height) {
            this.reset();
          }
        }

        draw() {
          ctx.beginPath();
          ctx.arc(this.x, this.y, this.sz, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${this.hue},${this.op})`;
          ctx.fill();
        }
      }

      const points = Array.from({ length: 110 }, () => new Pt());

      const drawConnections = () => {
        for (let i = 0; i < points.length; i += 1) {
          for (let j = i + 1; j < points.length; j += 1) {
            const dx = points[i].x - points[j].x;
            const dy = points[i].y - points[j].y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < 95) {
              ctx.beginPath();
              ctx.strokeStyle = `rgba(22,89,255,${0.07 * (1 - d / 95)})`;
              ctx.lineWidth = 0.5;
              ctx.moveTo(points[i].x, points[i].y);
              ctx.lineTo(points[j].x, points[j].y);
              ctx.stroke();
            }
          }
        }
      };

      const animate = () => {
        ctx.clearRect(0, 0, width, height);
        points.forEach((p) => {
          p.update();
          p.draw();
        });
        drawConnections();
        rafId = requestAnimationFrame(animate);
      };
      animate();

      cleanups.push(() => {
        window.removeEventListener("resize", resize);
        cancelAnimationFrame(rafId);
      });
    }

    const hvw = document.getElementById("hvw");
    const hdash = document.getElementById("hdash");
    if (hvw && hdash) {
      const onTiltMove = (e) => {
        const r = hvw.getBoundingClientRect();
        const rx = ((e.clientY - r.top - r.height / 2) / r.height) * -7;
        const ry = ((e.clientX - r.left - r.width / 2) / r.width) * 10;
        hdash.style.transform = `rotateX(${8 + rx}deg) rotateY(${ry}deg)`;
      };

      const onTiltLeave = () => {
        hdash.style.transform = "rotateX(8deg) rotateY(0deg)";
      };

      hvw.addEventListener("mousemove", onTiltMove);
      hvw.addEventListener("mouseleave", onTiltLeave);
      cleanups.push(() => {
        hvw.removeEventListener("mousemove", onTiltMove);
        hvw.removeEventListener("mouseleave", onTiltLeave);
      });
    }

    const srEls = Array.from(root.querySelectorAll(".sr2"));
    const srObs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            srObs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1 }
    );
    srEls.forEach((el) => srObs.observe(el));
    cleanups.push(() => srObs.disconnect());

    const animateCounter = (el, target, suffix) => {
      let start = 0;
      const duration = 1800;
      const step = (timestamp) => {
        if (!start) start = timestamp;
        const p = Math.min((timestamp - start) / duration, 1);
        const ease = 1 - Math.pow(1 - p, 3);
        el.textContent = `${Math.floor(ease * target)}${suffix}`;
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };

    const counters = Array.from(root.querySelectorAll("[data-t]"));
    const cntObs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const target = Number(entry.target.getAttribute("data-t"));
            const suffix = entry.target.getAttribute("data-s") || "";
            animateCounter(entry.target, target, suffix);
            cntObs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.5 }
    );
    counters.forEach((el) => cntObs.observe(el));
    cleanups.push(() => cntObs.disconnect());

    const faqQuestions = Array.from(root.querySelectorAll(".faqq"));
    const faqHandlers = faqQuestions.map((q) => {
      const handler = () => {
        const item = q.parentElement;
        const wasOpen = item?.classList.contains("open");
        root.querySelectorAll(".faqit").forEach((node) => node.classList.remove("open"));
        if (!wasOpen) item?.classList.add("open");
      };
      q.addEventListener("click", handler);
      return { q, handler };
    });
    cleanups.push(() => {
      faqHandlers.forEach(({ q, handler }) => q.removeEventListener("click", handler));
    });

    const magneticButtons = Array.from(root.querySelectorAll(".mbtn"));
    const magneticHandlers = magneticButtons.map((btn) => {
      const inner = btn.querySelector(".mbtn-inner");
      const onMagMove = (e) => {
        const r = btn.getBoundingClientRect();
        const x = (e.clientX - r.left - r.width / 2) * 0.25;
        const y = (e.clientY - r.top - r.height / 2) * 0.25;
        btn.style.transform = `translate(${x}px,${y}px)`;
        if (inner) inner.style.transform = `translate(${x * 0.3}px,${y * 0.3}px)`;
      };
      const onMagLeave = () => {
        btn.style.transform = "";
        if (inner) inner.style.transform = "";
      };
      btn.addEventListener("mousemove", onMagMove);
      btn.addEventListener("mouseleave", onMagLeave);
      return { btn, onMagMove, onMagLeave };
    });
    cleanups.push(() => {
      magneticHandlers.forEach(({ btn, onMagMove, onMagLeave }) => {
        btn.removeEventListener("mousemove", onMagMove);
        btn.removeEventListener("mouseleave", onMagLeave);
      });
    });

    const featureCards = Array.from(root.querySelectorAll(".fcard"));
    const featureHandlers = featureCards.map((card) => {
      const onGlowMove = (e) => {
        const r = card.getBoundingClientRect();
        card.style.background = `radial-gradient(circle 180px at ${e.clientX - r.left}px ${
          e.clientY - r.top
        }px,rgba(0,229,255,.05) 0%,rgba(255,255,255,.03) 100%)`;
      };
      const onGlowLeave = () => {
        card.style.background = "rgba(255,255,255,.03)";
      };
      card.addEventListener("mousemove", onGlowMove);
      card.addEventListener("mouseleave", onGlowLeave);
      return { card, onGlowMove, onGlowLeave };
    });
    cleanups.push(() => {
      featureHandlers.forEach(({ card, onGlowMove, onGlowLeave }) => {
        card.removeEventListener("mousemove", onGlowMove);
        card.removeEventListener("mouseleave", onGlowLeave);
      });
    });

    const tiltCards = Array.from(root.querySelectorAll(".bcard,.uccard"));
    const tiltHandlers = tiltCards.map((card) => {
      const onCardMove = (e) => {
        const r = card.getBoundingClientRect();
        const x = ((e.clientY - r.top - r.height / 2) / r.height) * -9;
        const y = ((e.clientX - r.left - r.width / 2) / r.width) * 9;
        card.style.transform = `translateY(-5px) rotateX(${x}deg) rotateY(${y}deg)`;
      };
      const onCardLeave = () => {
        card.style.transform = "";
      };
      card.addEventListener("mousemove", onCardMove);
      card.addEventListener("mouseleave", onCardLeave);
      return { card, onCardMove, onCardLeave };
    });
    cleanups.push(() => {
      tiltHandlers.forEach(({ card, onCardMove, onCardLeave }) => {
        card.removeEventListener("mousemove", onCardMove);
        card.removeEventListener("mouseleave", onCardLeave);
      });
    });

    const bubbles = Array.from(root.querySelectorAll("#dchat .cb"));
    const dphone = root.querySelector("#dphone");
    if (dphone) {
      const demoObs = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              bubbles.forEach((bubble, i) => {
                bubble.style.animation = "none";
                requestAnimationFrame(() => {
                  bubble.style.animation = `chIn .5s cubic-bezier(.16,1,.3,1) ${0.3 + i * 0.75}s forwards`;
                });
              });
              demoObs.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.3 }
      );
      demoObs.observe(dphone);
      cleanups.push(() => demoObs.disconnect());
    }

    return () => {
      cleanups.forEach((fn) => fn());
    };
  }, []);

  return (
    <div ref={rootRef}>
      <style>{STYLE_BLOCK}</style>

      <div id="cdot" />
      <div id="cring" />
      <canvas id="pc" />

      <section className="hero">
        <div className="hmesh" />
        <div className="hgrid" />
        <div className="hring hr1" />
        <div className="hring hr2" />
        <div className="hring hr3" />

        <div className="hcontent">
          <div className="hpill">
            <div className="pdot">⚡</div>
            <span>
              <em>AI Receptionist</em> is live — answering calls right now
            </span>
          </div>
          <h1 className="hh1">
            <span style={{ display: "block" }}>Never miss a</span>
            <span className="w2">customer again.</span>
          </h1>
          <p className="hsub">
            SmartConnect4u answers every call, captures every lead, and manages all your messages — WhatsApp,
            Instagram, Facebook, email — in one intelligent workspace.
          </p>
          <div className="hbtns">
            <button className="bprim mbtn" type="button" onClick={goToContactPage}>
              <span className="mbtn-inner">📅 Book a Demo</span>
            </button>
            <button
              className="bsec"
              type="button"
              onClick={() => document.getElementById("pric")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              ✨ View packages
            </button>
          </div>
          <div className="trust">
            <span>Built for busy teams</span>
            <span className="tsep" />
            <span>GDPR compliant</span>
            <span className="tsep" />
            <span>5-min setup</span>
          </div>
          <div className="sband">
            <div className="scell">
              <div className="snum" data-t="24" data-s="/7">0</div>
              <div className="slbl">AI Coverage</div>
            </div>
            <div className="scell">
              <div className="snum" data-t="50" data-s="+">0</div>
              <div className="slbl">Languages</div>
            </div>
            <div className="scell">
              <div className="snum">1</div>
              <div className="slbl">Unified Inbox</div>
            </div>
            <div className="scell">
              <div className="snum" data-t="10" data-s="">0</div>
              <div className="slbl">Max team size</div>
            </div>
          </div>
        </div>

        <div className="hvwrap" id="hvw">
          <div className="fnotif fnl">
            <div className="nico nt">📞</div>
            <div>
              <div style={{ fontSize: ".7rem", color: "var(--cyan)", marginBottom: 2 }}>New Call</div>
              <div style={{ color: "var(--w70)", fontSize: ".66rem" }}>AI answering now</div>
            </div>
          </div>
          <div className="fnotif fnr">
            <div className="nico ng">✅</div>
            <div>
              <div style={{ fontSize: ".7rem", color: "#00E89A", marginBottom: 2 }}>Task Created</div>
              <div style={{ color: "var(--w70)", fontSize: ".66rem" }}>Assigned to Neil</div>
            </div>
          </div>
          <div className="hdash" id="hdash">
            <div className="dshell">
              <div className="dchrome">
                <div className="cdots">
                  <div className="cdot2 cdr" />
                  <div className="cdot2 cdy" />
                  <div className="cdot2 cdg" />
                </div>
                <div className="curl">app.smartconnect4u.com</div>
              </div>
              <div className="dbody">
                <div className="dsidebar">
                  <div className="sni act"><div className="sico act">📥</div>Inbox</div>
                  <div className="sni"><div className="sico">📞</div>Calls</div>
                  <div className="sni"><div className="sico">✅</div>Tasks</div>
                  <div className="sni"><div className="sico">📱</div>Social</div>
                  <div className="sni"><div className="sico">✉️</div>Email</div>
                  <div className="sni"><div className="sico">📊</div>Analytics</div>
                </div>
                <div className="dmain">
                  <div>
                    <div className="dseclbl">🔴 Live Call</div>
                    <div className="lccard">
                      <div className="cava">AI</div>
                      <div style={{ flex: 1 }}>
                        <div className="cname">Tom B. — 07892 334 210</div>
                        <div className="csub"><div className="ldot" style={{ width: 4, height: 4 }} />Plumbing leak • 0:42</div>
                      </div>
                      <div className="lind"><div className="ldot" />LIVE</div>
                      <div className="wf">
                        <div className="wb" /><div className="wb" /><div className="wb" /><div className="wb" />
                        <div className="wb" /><div className="wb" /><div className="wb" /><div className="wb" />
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="dseclbl">💬 Messages</div>
                    <div className="mrow unr">
                      <div className="mava" style={{ background: "linear-gradient(135deg,#1659FF,#00E5FF)" }}>KL</div>
                      <div className="mbdy">
                        <div className="mname">Karen L. <span className="cpill cpwa">WA</span></div>
                        <div className="mprev">Is the 9am slot available?</div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                        <div style={{ fontSize: ".58rem", color: "var(--w40)" }}>2m</div>
                        <div className="ubadge">2</div>
                      </div>
                    </div>
                    <div className="mrow">
                      <div className="mava" style={{ background: "linear-gradient(135deg,#6E3AFF,#1659FF)" }}>SR</div>
                      <div className="mbdy"><div className="mname">Sarah R. <span className="cpill cpig">IG</span></div><div className="mprev">Loved your service!</div></div>
                      <div style={{ fontSize: ".58rem", color: "var(--w40)" }}>8m</div>
                    </div>
                    <div className="mrow">
                      <div className="mava" style={{ background: "linear-gradient(135deg,#0A44CC,#6E3AFF)" }}>DP</div>
                      <div className="mbdy"><div className="mname">David P. <span className="cpill cpem">Email</span></div><div className="mprev">Following up on quote…</div></div>
                      <div style={{ fontSize: ".58rem", color: "var(--w40)" }}>1h</div>
                    </div>
                  </div>
                </div>
                <div className="dtasks">
                  <div className="dseclbl">✅ Auto-Tasks</div>
                  <div className="tcard"><div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}><div className="tpri tr" /><div className="ttitle">Call back Tom — plumbing</div></div><div className="tassign">→ Neil</div></div>
                  <div className="tcard"><div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}><div className="tpri ty" /><div className="ttitle">Send quote to Karen</div></div><div className="tassign">→ Amy</div></div>
                  <div className="tcard"><div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}><div className="tpri tg" /><div className="ttitle">Confirm Sarah booking</div></div><div className="tassign">→ You</div></div>
                  <div style={{ marginTop: 9, padding: 7, background: "rgba(0,229,255,.07)", border: "1px solid rgba(0,229,255,.14)", borderRadius: 8, textAlign: "center", fontSize: ".6rem", color: "var(--cyan)" }}>⚡ 3 new leads today</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="live-demo-wrap">
          <button className="bprim mbtn" type="button" onClick={() => onShowService?.("receptionist")}>
            <span className="mbtn-inner">🎙 Live Demo →</span>
          </button>
        </div>
      </section>

      <div className="ticker">
        <div className="tlbl">Channels</div>
        <div className="ttrack">
          {[
            "📞 AI Phone Answering",
            "💬 WhatsApp Business",
            "📸 Instagram DMs",
            "👤 Facebook Messenger",
            "✉️ AI Email Manager",
            "📱 Social Media AI",
            "✅ Tasks & CRM",
            "🌍 50+ Languages",
            "🔒 GDPR Compliant"
          ]
            .concat([
              "📞 AI Phone Answering",
              "💬 WhatsApp Business",
              "📸 Instagram DMs",
              "👤 Facebook Messenger",
              "✉️ AI Email Manager",
              "📱 Social Media AI",
              "✅ Tasks & CRM",
              "🌍 50+ Languages",
              "🔒 GDPR Compliant"
            ])
            .map((item, i) => (
              <div key={`${item}-${i}`} className="titem">
                <em>{item}</em>
              </div>
            ))}
        </div>
      </div>

      <section className="psec">
        <div className="container">
          <div style={{ textAlign: "center" }} className="sr2">
            <div className="slabel"><span className="sldot" />The Reality</div>
            <h2 className="sh">Your business is losing customers<br /><span className="gt3">right now.</span></h2>
            <p className="ssub" style={{ margin: "12px auto 0", textAlign: "center" }}>Every missed call, ignored DM, unsent follow-up — that's revenue walking out the door.</p>
          </div>
          <div className="bgrid">
            <div className="bcard sr2 d1"><span className="bcnum">01</span><span className="bcem">📵</span><div className="bch">Missed calls = lost money</div><p className="bcp">67% of customers won't leave a voicemail. Miss the call, they call your competitor. Every. Single. Time.</p></div>
            <div className="bcard sr2 d2"><span className="bcnum">02</span><span className="bcem">🌪️</span><div className="bch">Messages scattered everywhere</div><p className="bcp">WhatsApp, Instagram, Facebook, email — your team is drowning in tabs and still missing things.</p></div>
            <div className="bcard sr2 d3"><span className="bcnum">03</span><span className="bcem">🫥</span><div className="bch">Inconsistent follow-ups</div><p className="bcp">Good intentions don't close deals. Without a system, leads go cold and revenue leaks away.</p></div>
          </div>
          <div className="sarr sr2"><div className="apipe" /><div className="atxt">SmartConnect4u fixes all of this</div><div className="apipe" style={{ background: "linear-gradient(180deg,var(--cyan),transparent)" }} /></div>
          <div className="bgrid">
            <div className="bcard sol sr2 d1" style={{ background: "linear-gradient(135deg,rgba(22,89,255,.1),rgba(0,229,255,.05))", borderColor: "rgba(0,229,255,.15)" }}><span className="bcnum" style={{ opacity: .07 }}>01</span><span className="bcem">🤖</span><div className="bch">AI Receptionist</div><p className="bcp">Answers every call 24/7 in a natural voice. Captures name, reason, urgency. Creates a task. No human needed.</p></div>
            <div className="bcard sol sr2 d2" style={{ background: "linear-gradient(135deg,rgba(22,89,255,.1),rgba(110,58,255,.05))", borderColor: "rgba(22,89,255,.2)" }}><span className="bcnum" style={{ opacity: .07 }}>02</span><span className="bcem">📥</span><div className="bch">Unified Smart Inbox</div><p className="bcp">One conversation per customer — WhatsApp, Instagram, Facebook, email — all in one workspace.</p></div>
            <div className="bcard sol sr2 d3" style={{ background: "linear-gradient(135deg,rgba(110,58,255,.1),rgba(22,89,255,.05))", borderColor: "rgba(110,58,255,.2)" }}><span className="bcnum" style={{ opacity: .07 }}>03</span><span className="bcem">📋</span><div className="bch">Tasks & CRM</div><p className="bcp">Every lead, auto-organised. Your team knows exactly what to do next. More conversions, less chaos.</p></div>
          </div>
        </div>
      </section>

      <section className="fsec" id="feat">
        <div className="container">
          <div className="sr2" style={{ textAlign: "center" }}>
            <div className="slabel"><span className="sldot" />Core Features</div>
            <h2 className="sh">Four modules. <span className="gt">One platform.</span></h2>
            <p className="ssub" style={{ textAlign: "center", margin: "12px auto 0" }}>Each module is powerful alone. Together, they make your business unstoppable.</p>
          </div>
          <div className="fgrid">
            <div className="fcard sr2 d1">
              <div className="forb foc" />
              <div className="fico fic">📞</div>
              <div className="ftit">AI Receptionist</div>
              <div className="fbadge">Powered by Twilio + AI Voice</div>
              <ul className="fbulls">
                <li><span className="chk">✓</span>Answers calls 24/7 with natural conversation in 50+ languages and accents</li>
                <li><span className="chk">✓</span>Captures name, reason, and urgency and creates a task automatically</li>
                <li><span className="chk">✓</span>Routes calls, takes messages, or does warm transfers to your team</li>
              </ul>
              <div className="mui">
                <div className="mcrow">
                  <div className="mcava maai">AI</div>
                  <div style={{ flex: 1 }}><div style={{ fontSize: ".7rem", fontWeight: 700, marginBottom: 2 }}>Tom B. — +44 7892 334 210</div><div style={{ fontSize: ".63rem", color: "var(--cyan)", display: "flex", alignItems: "center", gap: 3 }}><div className="ldot" style={{ width: 4, height: 4 }} />Live — 0:47</div></div>
                  <div className="mwsm"><div className="mwb" style={{ height: 4 }} /><div className="mwb" style={{ height: 12 }} /><div className="mwb" style={{ height: 18 }} /><div className="mwb" style={{ height: 10 }} /></div>
                </div>
                <div><span className="mctag">📋 Tom B.</span><span className="mctag">🔧 Leak — urgent</span><span className="mctag">📍 Kettering</span></div>
              </div>
            </div>
            <div className="fcard sr2 d2">
              <div className="forb fob" />
              <div className="fico fib">💬</div>
              <div className="ftit">Unified Smart Inbox</div>
              <div className="fbadge" style={{ background: "rgba(22,89,255,.1)", color: "var(--blue2)" }}>One inbox, all channels</div>
              <ul className="fbulls">
                <li><span className="chk">✓</span>WhatsApp, Instagram, Facebook, email — one thread per customer</li>
                <li><span className="chk">✓</span>AI suggests replies — approve in one click, or let it auto-respond</li>
                <li><span className="chk">✓</span>Assign conversations, add notes, and resolve as a team</li>
              </ul>
              <div className="mui">
                <div style={{ display: "flex", gap: 5, marginBottom: 9, flexWrap: "wrap" }}>
                  <span className="cpill cpwa" style={{ padding: "3px 8px", fontSize: ".62rem" }}>💬 WhatsApp</span>
                  <span className="cpill cpig" style={{ padding: "3px 8px", fontSize: ".62rem" }}>📸 Instagram</span>
                  <span className="cpill cpfb" style={{ padding: "3px 8px", fontSize: ".62rem" }}>👤 Facebook</span>
                </div>
                <div className="imrow act">
                  <div className="imava" style={{ background: "linear-gradient(135deg,var(--blue),var(--cyan))" }}>KL</div>
                  <div className="imtxt"><div className="imn">Karen L. <span className="cpill cpwa">WA</span></div><div className="imm">Is the 9am free?</div></div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}><div className="imt">2m</div><div className="ubadge" style={{ width: 13, height: 13, fontSize: ".52rem" }}>2</div></div>
                </div>
                <div className="imrow"><div className="imava" style={{ background: "linear-gradient(135deg,var(--violet),var(--blue))" }}>SR</div><div className="imtxt"><div className="imn">Sarah R. <span className="cpill cpig">IG</span></div><div className="imm">AI replied ✓</div></div><div className="imt">8m</div></div>
              </div>
            </div>
            <div className="fcard sr2 d3">
              <div className="forb fov" />
              <div className="fico fiv">✉️</div>
              <div className="ftit">AI Email Manager</div>
              <div className="fbadge" style={{ background: "rgba(110,58,255,.1)", color: "var(--violet2)" }}>Triage · Drafts · Follow-ups</div>
              <ul className="fbulls">
                <li><span className="chk">✓</span>AI triages and summarises every email so you focus on what matters</li>
                <li><span className="chk">✓</span>Auto-drafts personalised replies ready to approve in seconds</li>
                <li><span className="chk">✓</span>Smart follow-up sequences so no lead goes cold</li>
              </ul>
              <div className="mui">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 7 }}>
                  <div><div style={{ fontSize: ".58rem", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#FF4D6A", marginBottom: 5 }}>🔴 Urgent</div><div style={{ background: "rgba(255,77,106,.08)", border: "1px solid rgba(255,77,106,.14)", borderRadius: 8, padding: 7 }}><div style={{ fontSize: ".63rem", fontWeight: 700, marginBottom: 2 }}>Quote req.</div><div style={{ fontSize: ".57rem", color: "var(--cyan)" }}>AI draft ready</div></div></div>
                  <div><div style={{ fontSize: ".58rem", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#FFB800", marginBottom: 5 }}>🟡 Follow-up</div><div style={{ background: "rgba(255,184,0,.05)", border: "1px solid rgba(255,184,0,.13)", borderRadius: 8, padding: 7 }}><div style={{ fontSize: ".63rem", fontWeight: 700, marginBottom: 2 }}>Invoice #201</div><div style={{ fontSize: ".57rem", color: "var(--w40)" }}>3 days ago</div></div></div>
                  <div><div style={{ fontSize: ".58rem", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#00E89A", marginBottom: 5 }}>✅ Done</div><div style={{ background: "rgba(0,232,154,.05)", border: "1px solid rgba(0,232,154,.11)", borderRadius: 8, padding: 7 }}><div style={{ fontSize: ".63rem", fontWeight: 700, marginBottom: 2 }}>Confirmed</div><div style={{ fontSize: ".57rem", color: "var(--w40)" }}>Resolved</div></div></div>
                </div>
              </div>
            </div>
            <div className="fcard sr2 d4">
              <div className="forb fot" />
              <div className="fico fit">📱</div>
              <div className="ftit">AI Social Media Manager</div>
              <div className="fbadge" style={{ background: "rgba(0,196,180,.1)", color: "var(--teal)" }}>Reply · Schedule · Publish</div>
              <ul className="fbulls">
                <li><span className="chk">✓</span>Replies to DMs and comments across Instagram, Facebook, and more</li>
                <li><span className="chk">✓</span>Schedules and publishes posts at optimal engagement times</li>
                <li><span className="chk">✓</span>Auto-moderates comments and highlights top reviews</li>
              </ul>
              <div className="mui">
                <div style={{ display: "flex", gap: 5, marginBottom: 9, flexWrap: "wrap" }}>
                  <div style={{ background: "rgba(228,64,95,.1)", border: "1px solid rgba(228,64,95,.2)", borderRadius: 8, padding: "4px 9px", fontSize: ".63rem", color: "#E4405F", fontWeight: 700 }}>📸 Instagram</div>
                  <div style={{ background: "rgba(24,119,242,.1)", border: "1px solid rgba(24,119,242,.2)", borderRadius: 8, padding: "4px 9px", fontSize: ".63rem", color: "#1877F2", fontWeight: 700 }}>👤 Facebook</div>
                  <div style={{ background: "var(--w04)", border: "1px solid var(--w08)", borderRadius: 8, padding: "4px 9px", fontSize: ".63rem", color: "var(--w40)", fontWeight: 600 }}>🔗 LinkedIn <span style={{ fontSize: ".55rem", background: "rgba(110,58,255,.14)", color: "var(--violet2)", padding: "1px 5px", borderRadius: 4 }}>Soon</span></div>
                </div>
                <div style={{ background: "var(--w04)", border: "1px solid var(--w08)", borderRadius: 9, padding: 9 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}><div style={{ width: 20, height: 20, borderRadius: "50%", background: "linear-gradient(135deg,var(--blue),var(--teal))" }} /><div style={{ fontSize: ".68rem", fontWeight: 600 }}>YourBusiness <span style={{ color: "var(--w40)", fontWeight: 400 }}>· 3pm</span></div><div style={{ marginLeft: "auto", fontSize: ".57rem", background: "rgba(0,229,255,.1)", color: "var(--cyan)", padding: "2px 6px", borderRadius: 100, fontWeight: 700 }}>AI draft</div></div>
                  <div style={{ fontSize: ".7rem", color: "var(--w70)", lineHeight: 1.5, marginBottom: 7 }}>🚀 Now open weekends! Book your slot — link in bio.</div>
                  <div style={{ display: "flex", gap: 11, fontSize: ".6rem", color: "var(--w40)" }}><span>❤️ 48</span><span>💬 7</span><span>📤 Share</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="howsec" id="how">
        <div className="container">
          <div className="sr2" style={{ textAlign: "center" }}>
            <div className="slabel"><span className="sldot" />How It Works</div>
            <h2 className="sh">Live in minutes. <span className="gt2">Growing from day one.</span></h2>
          </div>
          <div className="stps">
            <div className="scol sr2 d1"><div className="snum2"><div className="sni2">1</div></div><h3>Connect your channels</h3><p>Link your phone number, WhatsApp, Instagram, Facebook, and email. Under 5 minutes — no dev needed.</p><div className="stags"><span className="stag stc">📞 Calls</span><span className="stag stb">💬 WhatsApp</span><span className="stag stv">📸 Instagram</span></div></div>
            <div className="scol sr2 d2"><div className="snum2"><div className="sni2">2</div></div><h3>AI handles everything</h3><p>SmartConnect4u answers calls, replies to messages, triages emails, and captures leads automatically, 24/7.</p><div className="stags"><span className="stag stc">⚡ 24/7</span><span className="stag stb">🌍 50+ languages</span></div></div>
            <div className="scol sr2 d3"><div className="snum2"><div className="sni2">3</div></div><h3>Team follows up. You grow.</h3><p>Tasks and leads appear instantly. Your team knows exactly what to do next. More conversions, less chaos.</p><div className="stags"><span className="stag stv">📈 More revenue</span></div></div>
          </div>
        </div>
      </section>

      <section className="demsec">
        <div className="container">
          <div className="sr2" style={{ textAlign: "center" }}>
            <div className="slabel"><span className="sldot" />Live Preview</div>
            <h2 className="sh">Watch the AI work.</h2>
            <p className="ssub" style={{ textAlign: "center", margin: "12px auto 0" }}>A real conversation handled entirely by SmartConnect4u.</p>
          </div>
          <div className="dphone sr2" id="dphone">
            <div className="ptopbar"><div className="pava">AI</div><div className="pinfo"><div className="pname">SmartConnect4u</div><div className="pstat"><div className="ldot" />Answering calls 24/7</div></div><div className="lind"><div className="ldot" />LIVE</div></div>
            <div className="pbody" id="dchat">
              <div className="cb cbc">"Hi, I've got a leak under my kitchen sink. Is someone available today?"</div>
              <div className="cb cbai">Hi there! A leak sounds urgent — we'll get someone out fast. Can I take your name and address?</div>
              <div className="cb cbc">"It's Tom, 14 Maple Close, Kettering."</div>
              <div className="cb cbsys">⚡ Task created: Tom B. — Urgent leak · 14 Maple Close · Assigned to Neil</div>
              <div className="cb cbai">Got it, Tom! I've flagged this as urgent. Neil will call you back within 15 minutes.</div>
            </div>
          </div>
        </div>
      </section>

      <section className="ucsec" id="uc">
        <div className="container">
          <div className="sr2" style={{ textAlign: "center" }}>
            <div className="slabel"><span className="sldot" />Use Cases</div>
            <h2 className="sh">Built for businesses <span className="gt">that never stop.</span></h2>
          </div>
          <div className="ucgrid">
            <div className="uccard sr2 d1"><span className="ucem">🏥</span><div className="uctit">Clinics & Healthcare</div><ul className="ucit"><li>Appointment booking and reminders</li><li>Prescription enquiries and referrals</li><li>After-hours triage and routing</li></ul></div>
            <div className="uccard sr2 d2"><span className="ucem">🔧</span><div className="uctit">Trades & Home Services</div><ul className="ucit"><li>Emergency call-out requests</li><li>Quote bookings and scheduling</li><li>Job status and follow-up updates</li></ul></div>
            <div className="uccard sr2 d3"><span className="ucem">🏠</span><div className="uctit">Real Estate</div><ul className="ucit"><li>Property viewing requests</li><li>Buyer and vendor enquiries</li><li>Offer updates and follow-up chains</li></ul></div>
            <div className="uccard sr2 d1"><span className="ucem">🍽️</span><div className="uctit">Restaurants</div><ul className="ucit"><li>Table reservations and cancellations</li><li>Menu and allergy enquiries</li><li>Event and private hire bookings</li></ul></div>
            <div className="uccard sr2 d2"><span className="ucem">⚖️</span><div className="uctit">Legal & Accounting</div><ul className="ucit"><li>Initial consultation requests</li><li>Document and deadline reminders</li><li>Client onboarding and intake</li></ul></div>
            <div className="uccard sr2 d3"><span className="ucem">💼</span><div className="uctit">Sales Teams</div><ul className="ucit"><li>Inbound lead capture and qualify</li><li>Demo booking and follow-up</li><li>Pipeline updates and task alerts</li></ul></div>
          </div>
        </div>
      </section>

      <section className="intsec" id="int">
        <div className="container">
          <div className="sr2" style={{ textAlign: "center" }}>
            <div className="slabel"><span className="sldot" />Integrations</div>
            <h2 className="sh">Connect in minutes. <span className="gt2">More channels coming.</span></h2>
          </div>
          <div className="intgrid sr2">
            <div className="intcard"><div className="intlogo">📞</div><div className="intname">Twilio Voice</div></div>
            <div className="intcard"><div className="intlogo">💬</div><div className="intname">WhatsApp Business</div></div>
            <div className="intcard"><div className="intlogo">📸</div><div className="intname">Instagram</div></div>
            <div className="intcard"><div className="intlogo">👤</div><div className="intname">Facebook Messenger</div></div>
            <div className="intcard"><div className="intlogo">✉️</div><div className="intname">Email IMAP/SMTP</div></div>
            <div className="intcard" style={{ borderColor: "rgba(110,58,255,.2)" }}><div className="intlogo">🔗</div><div className="intname">LinkedIn</div><div className="intsoon">Coming Soon</div></div>
            <div className="intcard" style={{ borderColor: "rgba(110,58,255,.2)" }}><div className="intlogo">𝕏</div><div className="intname">X / Twitter</div><div className="intsoon">Coming Soon</div></div>
          </div>
        </div>
      </section>

      <section className="pricsec" id="pric">
        <div className="container">
          <div className="sr2" style={{ textAlign: "center" }}>
            <div className="slabel"><span className="sldot" />Pricing</div>
            <h2 className="sh">Simple pricing. <span className="gt">Scale as you grow.</span></h2>
            <p className="ssub" style={{ textAlign: "center", margin: "12px auto 0" }}>Start free. No contracts. Cancel anytime.</p>
          </div>
          <div className="pric-packages sr2">
            <PricingPackages
              onSelectPackage={(id) => onSelectPlan?.(id, { source: "landing" })}
              centered
              geoCountryCode={geoCountryCode}
              fxRates={fxRates}
            />
          </div>
        </div>
      </section>

      <section className="faqsec" id="faq">
        <div className="container">
          <div className="sr2" style={{ textAlign: "center" }}>
            <div className="slabel"><span className="sldot" />FAQ</div>
            <h2 className="sh" style={{ textAlign: "center" }}>Questions answered.</h2>
          </div>
          <div className="faqlist">
            {FAQ_ITEMS.map((item, idx) => (
              <div key={item.q} className={`faqit sr2 ${idx % 2 === 0 ? "d1" : "d2"}`}>
                <div className="faqq">{item.q}</div>
                <div className="faqa">{item.a}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="ctasec">
        <div className="corb co1" />
        <div className="corb co2" />
        <div className="corb co3" />
        <div className="ctain sr2">
          <div className="slabel" style={{ margin: "0 auto 22px", display: "inline-flex" }}><span className="sldot" />Get Started</div>
          <h2 className="ctah">Ready to stop missing<br /><span className="gt">customers?</span></h2>
          <p className="ctasub">Join hundreds of businesses running on SmartConnect4u. Set up in 5 minutes.</p>
          <div className="ctabtns">
            <button className="bprim mbtn" type="button" style={{ fontSize: "1.05rem", padding: "18px 40px" }} onClick={goToContactPage}><span className="mbtn-inner">📅 Book a Demo</span></button>
            <button className="bsec" type="button" style={{ fontSize: "1.05rem", padding: "18px 40px" }} onClick={() => onLogin?.()}>✨ Login</button>
          </div>
          <p className="ctafn">No credit card required · GDPR compliant · Cancel anytime</p>
        </div>
      </section>

      <footer>
        <div className="ftgrid">
          <div className="ftbrand">
            <div className="ftsocials">
              <a
                className="ftsocial"
                href="https://www.facebook.com/smartconnect4u"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="SmartConnect4u on Facebook"
                title="Facebook"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M13.5 21v-7h2.3l.4-3h-2.7V9.1c0-.9.3-1.5 1.6-1.5h1.3V5c-.2 0-.9-.1-2-.1-2.1 0-3.5 1.3-3.5 3.7V11H8.5v3H11v7h2.5z" />
                </svg>
              </a>
              <a
                className="ftsocial"
                href="https://www.instagram.com/smartconnect_4u"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="SmartConnect4u on Instagram"
                title="Instagram"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7.5 2h9A5.5 5.5 0 0 1 22 7.5v9A5.5 5.5 0 0 1 16.5 22h-9A5.5 5.5 0 0 1 2 16.5v-9A5.5 5.5 0 0 1 7.5 2zm0 2A3.5 3.5 0 0 0 4 7.5v9A3.5 3.5 0 0 0 7.5 20h9a3.5 3.5 0 0 0 3.5-3.5v-9A3.5 3.5 0 0 0 16.5 4h-9zm10 1.5a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4zM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
                </svg>
              </a>
            </div>
          </div>
          <ul className="ftnav">
            <li><a href="#feat">Product</a></li>
            <li><a href="#pric">Pricing</a></li>
            <li><a href="#int">Integrations</a></li>
            <li><a href="/careers.html">Careers</a></li>
            <li><a href="/blog.html">Blogs</a></li>
            <li><a href="/contact.html">Support</a></li>
            <li><a href="/privacy.html">Privacy</a></li>
          </ul>
          <p className="ftcopy">© 2026 SmartConnect4u. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
