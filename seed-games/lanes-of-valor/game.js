(() => {
  'use strict';
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const $ = id => document.getElementById(id);
  const ui = {
    gold:$('gold'), wave:$('wave'), hp:$('baseHp'), objective:$('objective'), weapon:$('weapon'), weaponLv:$('weaponLv'),
    overlay:$('overlay'), start:$('startCard'), shop:$('shopCard'), pause:$('pauseCard'), over:$('overCard'),
    shopGold:$('shopGold'), shopWave:$('shopWave'), toast:$('toast')
  };
  const enemyVariants=[70,80,41,51,31,21,11];
  const actorImages={hero:{},enemies:{}};
  let actorData=null;
  function loadImage(src){const im=new Image();const ready=new Promise(resolve=>{im.onload=()=>resolve(true);im.onerror=()=>resolve(false);});im.src=src;return {im,ready};}
  const background=loadImage('assets/background.png'),backgroundImage=background.im;
  const assetsReady=fetch('assets/actors.json').then(r=>{if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();}).then(async data=>{
    actorData=data;const loads=[background.ready];
    for(const [action,meta] of Object.entries(data.hero)){if(typeof meta==='object'&&meta.file){const asset=loadImage(`assets/${meta.file}`);actorImages.hero[action]=asset.im;loads.push(asset.ready);}}
    for(const unit of data.enemies){actorImages.enemies[unit.id]={};for(const [action,meta] of Object.entries(unit.actions)){const asset=loadImage(`assets/${meta.file}`);actorImages.enemies[unit.id][action]=asset.im;loads.push(asset.ready);}}
    const results=await Promise.all(loads);if(results.some(ok=>!ok))console.warn('Một số sprite không tải được');
  }).catch(err=>console.error('Không tải được nhân vật:',err)).finally(()=>{const btn=$('playBtn');btn.disabled=false;btn.innerHTML='VÀO TRẬN <span>→</span>';});
  let W=960,H=540,DPR=1, laneY=[], last=0, state='menu', wave=0, gold=0, baseHp=100, playerHp=3, score=0, kills=0;
  let player={lane:1,x:.17,fire:0,hit:0,level:1,damageLv:1,speedLv:1,damage:36,rate:1.05,moveClip:0,attackClip:0};
  let enemies=[], shots=[], particles=[], structures=[null,null,null], waveTime=0, spawnClock=0, waveKills=0, noBaseDamage=true, toastTimer=0, moveCooldown=0;
  let shake=0, aimFlash=0, personalBest=0, furthestWave=0, shopFrom='wave', shopLane=1;
  const rand=(a,b)=>a+Math.random()*(b-a);
  function resize(){
    const r=canvas.getBoundingClientRect(); DPR=Math.min(window.devicePixelRatio||1,2); W=Math.max(320,r.width); H=Math.max(220,r.height);
    canvas.width=Math.round(W*DPR); canvas.height=Math.round(H*DPR); ctx.setTransform(DPR,0,0,DPR,0,0);
    laneY=[H*.25,H*.5,H*.75];
  }
  new ResizeObserver(resize).observe(canvas); resize();
  function toast(t){ui.toast.textContent=t;ui.toast.classList.add('show');toastTimer=1.8;}
  function hud(){ui.gold.textContent=gold;ui.wave.textContent=wave;ui.hp.textContent=Math.max(0,Math.ceil(baseHp));ui.weaponLv.textContent=`CẤP ${player.level}`;ui.objective.textContent=state==='playing'?(waveTime>0?`Đợt ${wave} · còn ${Math.ceil(waveTime)} giây sinh quái`:`Đợt ${wave} · hạ ${enemies.length} quái còn lại`):state==='shop'?`Đợt ${wave} · đang gia cố`:'Chuẩn bị giữ tuyến';}
  function setOverlay(name){[ui.start,ui.shop,ui.pause,ui.over].forEach(x=>x.classList.add('hidden'));if(name){ui.overlay.classList.remove('off');ui[name].classList.remove('hidden');}else ui.overlay.classList.add('off');}
  function begin(){
    state='playing';wave=1;gold=55;baseHp=100;playerHp=3;score=0;kills=0;player={lane:1,x:.17,fire:0,hit:0,level:1,damageLv:1,speedLv:1,damage:36,rate:1.05,moveClip:0,attackClip:0};enemies=[];shots=[];particles=[];structures=[null,null,null];waveTime=28;spawnClock=1.5;waveKills=0;noBaseDamage=true;setOverlay(null);hud();
    try{GameHub.gameStart();}catch(_){}
    toast('Đợt 1 · Giữ tuyến!');
  }
  function endRun(){if(state!=='playing')return;state='over';setOverlay('over');$('runSummary').textContent=`Bạn đã giữ được ${Math.max(0,wave-1)} đợt và hạ ${kills} quái.`;$('runScore').textContent=score.toLocaleString('vi-VN');hud();
    const meta={wave:Math.max(0,wave-1),kills};personalBest=Math.max(personalBest,score);furthestWave=Math.max(furthestWave,wave-1);try{GameHub.gameOver({score,meta});GameHub.save({best:personalBest,wave:furthestWave});}catch(_){}
  }
  function setLane(next){if(state!=='playing')return;next=Math.max(0,Math.min(2,next));if(next!==player.lane){player.lane=next;player.moveClip=.5;}moveCooldown=.16;}
  function moveLane(n){setLane(player.lane+n);}
  function refreshShop(){ui.shopGold.textContent=gold;ui.shopWave.textContent=wave;$('damageCost').textContent=60+(player.damageLv-1)*35;$('speedCost').textContent=70+(player.speedLv-1)*35;
    document.querySelectorAll('[data-shop-lane]').forEach(btn=>{const lane=Number(btn.dataset.shopLane);btn.classList.toggle('selected',lane===shopLane);btn.setAttribute('aria-pressed',String(lane===shopLane));const s=structures[lane];$(`laneStatus${lane}`).textContent=s?.type==='wall'?`Tường ${s.hp}/2`:s?.type==='trap'&&s.ready?'Bẫy sẵn sàng':'Trống';});
    for(const btn of document.querySelectorAll('[data-buy]')){const type=btn.dataset.buy;const costs={wall:35,trap:45,damage:60+(player.damageLv-1)*35,speed:70+(player.speedLv-1)*35,heal:40};btn.disabled=type!=='continue'&&(gold<costs[type]||((type==='wall'||type==='trap')&&!!structures[shopLane])||(type==='heal'&&baseHp>=100));}
  }
  function openShop(from=state==='playing'?'mid':'wave'){if(state!=='playing')return;shopFrom=from;shopLane=player.lane;state='shop';$('shopContext').textContent=from==='mid'?`TẠM DỪNG ĐỢT ${wave} · XÂY PHÒNG TUYẾN`:`KHOẢNG NGHỈ SAU ĐỢT ${wave}`;$('continueLabel').textContent=from==='mid'?'Trở lại trận':'Đợt tiếp theo';$('continueHint').textContent=from==='mid'?'Tiếp tục đợt đang diễn ra':'Sẵn sàng đón đợt tiếp theo';$('continueBtn').innerHTML=from==='mid'?'TRỞ LẠI TRẬN <span>→</span>':'ĐỢT TIẾP THEO <span>→</span>';$('shopTip').textContent=from==='mid'?'Thời gian và quái tạm dừng khi xây.':'Chọn làn cần phòng thủ trước khi mua.';refreshShop();setOverlay('shop');ui.shop.scrollTop=0;}
  function resumeWave(){if(state!=='shop')return;state='playing';if(shopFrom==='wave'){wave++;waveKills=0;noBaseDamage=true;waveTime=Math.max(23,31-wave*.55);spawnClock=1.3;toast(`Đợt ${wave} bắt đầu`);}else toast(`Tiếp tục đợt ${wave}`);setOverlay(null);hud();}
  function buy(type){if(state!=='shop')return;let cost=0;
    if(type==='wall'){cost=35;if(structures[shopLane])return toast('Làn này đã có công trình');if(gold<cost)return toast('Chưa đủ vàng · cần 35');structures[shopLane]={type:'wall',hp:2};}
    if(type==='trap'){cost=45;if(structures[shopLane])return toast('Làn này đã có công trình');if(gold<cost)return toast('Chưa đủ vàng · cần 45');structures[shopLane]={type:'trap',ready:true};}
    if(type==='damage'){cost=60+(player.damageLv-1)*35;if(gold<cost)return toast('Chưa đủ vàng');player.damage=Math.round(player.damage*1.35);player.damageLv++;player.level++;}
    if(type==='speed'){cost=70+(player.speedLv-1)*35;if(gold<cost)return toast('Chưa đủ vàng');player.rate=Math.max(.42,player.rate*.84);player.speedLv++;player.level++;}
    if(type==='heal'){cost=40;if(gold<cost)return toast('Chưa đủ vàng · cần 40');baseHp=Math.min(100,baseHp+25);}
    if(type==='continue')return resumeWave();
    gold-=cost;refreshShop();hud();toast(type==='wall'?`Đã dựng tường ở làn ${shopLane+1}`:type==='trap'?`Đã đặt bẫy ở làn ${shopLane+1}`:type==='heal'?'Căn cứ đã hồi 25 máu':'Nâng cấp thành công');
  }
  function spawn(){const lane=Math.floor(Math.random()*3);const boss=wave%5===0&&waveTime>13&&Math.random()<.3;const kind=enemyVariants[Math.floor(Math.random()*enemyVariants.length)];const hp=(28+wave*8)*(boss?4:1);enemies.push({lane,x:rand(.86,.98),hp,max:hp,speed:rand(.025,.044)+wave*.0013,damage:(boss?14:7)+Math.floor(wave*.8),size:boss?1.35:1,kind,boss,attack:0,flash:0,offset:rand(-5,5)});}
  function fire(){const lane=player.lane;let target=null;for(const e of enemies)if(e.lane===lane&&(!target||e.x<target.x))target=e;if(!target)return;
    shots.push({x:player.x+.045,y:laneY[lane]-12,target,damage:player.damage,speed:.38});player.fire=player.rate;player.attackClip=actorData?.hero?.attack?.duration||.58;aimFlash=.1;}
  function damageEnemy(e,d){e.hp-=d;e.flash=.11;for(let i=0;i<4;i++)particles.push({x:e.x*W,y:laneY[e.lane]+rand(-18,2),vx:rand(-35,35),vy:rand(-45,10),life:.35,color:e.boss?'#f3ae58':'#a6d07b'});}
  function update(dt){
    if(toastTimer>0){toastTimer-=dt;if(toastTimer<=0)ui.toast.classList.remove('show');}
    if(state!=='playing')return;
    moveCooldown=Math.max(0,moveCooldown-dt);player.fire-=dt;player.hit-=dt;player.moveClip=Math.max(0,player.moveClip-dt);player.attackClip=Math.max(0,player.attackClip-dt);waveTime-=dt;spawnClock-=dt;aimFlash=Math.max(0,aimFlash-dt);
    if(spawnClock<=0&&waveTime>0){spawn();spawnClock=Math.max(.8,2.7-wave*.14)*rand(.8,1.2);}
    if(player.fire<=0)fire();
    for(let i=shots.length-1;i>=0;i--){const s=shots[i];if(!enemies.includes(s.target)){shots.splice(i,1);continue;}const tx=s.target.x*W,ty=laneY[s.target.lane]-8,dx=tx-s.x*W,dy=ty-s.y,dist=Math.hypot(dx,dy),step=s.speed*W*dt;if(dist<=step+12){damageEnemy(s.target,s.damage);shots.splice(i,1);}else{s.x+=dx/dist*s.speed*dt;s.y+=dy/dist*step;}}
    for(let i=enemies.length-1;i>=0;i--){const e=enemies[i];e.flash=Math.max(0,e.flash-dt);const st=structures[e.lane];const stopAt=st?.type==='wall'?.44:.115;
      if(st?.type==='trap'&&st.ready&&e.x<.46){damageEnemy(e,Math.max(30,e.max*.65));structures[e.lane]=null;toast('Bẫy kích hoạt!');}
      if(e.hp<=0)continue;
      if(e.x<stopAt){e.attack-=dt;if(e.attack<=0){e.attack=1.0;if(st?.type==='wall'&&st.hp>0){st.hp--;if(st.hp<=0)structures[e.lane]=null;particles.push({x:e.x*W,y:laneY[e.lane],vx:-20,vy:-10,life:.4,color:'#c39559'});}else{baseHp-=e.damage;e.breached=true;noBaseDamage=false;shake=.25;particles.push({x:W*.08,y:laneY[e.lane],vx:-45,vy:-15,life:.5,color:'#ed7667'});toast(`Quái lọt qua làn ${e.lane+1} · căn cứ -${e.damage}`);if(baseHp<=0){baseHp=0;endRun();break;}}}}
      else e.x-=e.speed*dt;
      if(e.lane===player.lane&&e.x<player.x+.055&&e.x>player.x-.055&&player.hit<=0){player.hit=1.15;playerHp--;shake=.12;toast(`Bị trúng đòn · còn ${playerHp} ♥`);if(playerHp<=0){baseHp-=12;playerHp=3;player.lane=(player.lane+1)%3;if(baseHp<=0){baseHp=0;endRun();break;}}}
    }
    enemies=enemies.filter(e=>{if(e.breached)return false;if(e.hp<=0){gold+=e.boss?28:8;score+=e.boss?160:25;kills++;waveKills++;if(e.boss){toast('Đã hạ quái trùm!');try{GameHub.unlockAchievement('boss_slayer');}catch(_){}}return false;}return true;});
    for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt;if(p.life<=0)particles.splice(i,1);}
    if(waveTime<=0&&enemies.length===0){if(noBaseDamage&&wave>=1)try{GameHub.unlockAchievement('perfect_wave');}catch(_){}if(wave===5)try{GameHub.unlockAchievement('wave_five');}catch(_){}openShop('wave');}
    hud();
  }
  function pathRound(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}
  function drawBackground(t){
    if(backgroundImage.complete&&backgroundImage.naturalWidth){ctx.drawImage(backgroundImage,0,0,W,H);}else{ctx.fillStyle='#bc672f';ctx.fillRect(0,0,W,H);}
    ctx.fillStyle='#2419238a';ctx.fillRect(0,0,W,H);
    const vignette=ctx.createRadialGradient(W*.5,H*.48,H*.08,W*.5,H*.48,H*.8);vignette.addColorStop(0,'#9a583326');vignette.addColorStop(1,'#150f1d94');ctx.fillStyle=vignette;ctx.fillRect(0,0,W,H);
    laneY.forEach((y,i)=>{
      const h=H*.205,x=W*.055,w=W*.89;
      ctx.fillStyle='#18131d77';pathRound(x-2,y-h/2+6,w+4,h+8,12);ctx.fill();
      const road=ctx.createLinearGradient(0,y-h/2,0,y+h/2);road.addColorStop(0,'#5b343b');road.addColorStop(.5,'#885346');road.addColorStop(1,'#57323a');
      ctx.fillStyle=road;pathRound(x,y-h/2,w,h,10);ctx.fill();ctx.strokeStyle='#e5ad6877';ctx.lineWidth=Math.max(1,H*.004);ctx.stroke();
      if(state==='playing'&&i===player.lane){ctx.fillStyle='#f2c87210';pathRound(x+3,y-h/2+3,w-6,h-6,8);ctx.fill();ctx.strokeStyle='#f2c87270';ctx.lineWidth=2;ctx.stroke();}
      ctx.strokeStyle='#e8c28d39';ctx.lineWidth=1;ctx.setLineDash([3,10]);ctx.beginPath();ctx.moveTo(x+12,y+h*.38);ctx.lineTo(x+w-12,y+h*.38);ctx.stroke();ctx.setLineDash([]);
      // Warm stone inlays break up the running lane without competing with the hand-painted characters.
      for(let j=0;j<9;j++){const xx=x+w*(.13+j*.095)+Math.sin(j*7+i)*4;const yy=y+Math.sin(j*2.7+i)*h*.28;ctx.fillStyle=j%2?'#edc27d24':'#321e2d35';pathRound(xx,yy,7+(j%3)*3,2,1);ctx.fill();}
      ctx.fillStyle='#f5d7aeac';ctx.font=`700 ${Math.max(8,H*.02)}px system-ui`;ctx.textAlign='left';ctx.fillText(`0${i+1}`,x+10,y-h*.33);
    });
    // Fortress silhouette at the left: the path now ends at this gate, where breaches damage the base.
    const bx=W*.075,by=H*.5;ctx.fillStyle='#251b29';pathRound(bx-20,by-H*.29,40,H*.58,6);ctx.fill();ctx.strokeStyle='#d49a5e';ctx.lineWidth=3;ctx.stroke();
    ctx.fillStyle='#a86c4c';ctx.beginPath();ctx.moveTo(bx-26,by-H*.29);ctx.lineTo(bx,by-H*.36);ctx.lineTo(bx+26,by-H*.29);ctx.closePath();ctx.fill();
    for(const y of laneY){ctx.fillStyle='#38242f';pathRound(bx-14,y-H*.06,28,H*.12,4);ctx.fill();ctx.strokeStyle='#d6a66d';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle='#f1c879';ctx.beginPath();ctx.arc(bx,y,3.5,0,Math.PI*2);ctx.fill();}
    // Three matching painted spawn arches.
    laneY.forEach((y,i)=>{const x=W*.94,r=Math.min(H*.065,W*.032);ctx.fillStyle='#30232e';pathRound(x-r,y-r,r*2,r*2,8);ctx.fill();ctx.strokeStyle='#d49c62';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle='#f18155';ctx.shadowColor='#f18155';ctx.shadowBlur=12;ctx.beginPath();ctx.arc(x,y,4+Math.sin(t*3+i)*1,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#f3d4a8';ctx.font=`700 ${Math.max(8,H*.02)}px system-ui`;ctx.textAlign='center';ctx.fillText(`G${i+1}`,x,y+r+H*.04);});
  }
  function drawStrip(meta,image,frame,x,y,height,flip=false,alpha=1){
    if(!meta||!image?.complete||!image.naturalWidth)return false;
    const fw=meta.width,fh=meta.height,iw=height*meta.ratio,phase=Math.max(0,Math.min(meta.frames-.001,frame)),a=Math.floor(phase),b=(a+1)%meta.frames,mix=phase-a;
    ctx.save();ctx.translate(x,y);if(flip)ctx.scale(-1,1);ctx.globalAlpha=alpha*(1-mix);ctx.drawImage(image,a*fw,0,fw,fh,-iw/2,-height*.52,iw,height);if(mix>0){ctx.globalAlpha=alpha*mix;ctx.drawImage(image,b*fw,0,fw,fh,-iw/2,-height*.52,iw,height);}ctx.restore();return true;
  }
  function animationFrame(meta,elapsed,loop=true){if(!meta)return 0;const p=loop?(elapsed%meta.duration)/meta.duration:Math.min(1,Math.max(0,elapsed/meta.duration));return p*(loop?meta.frames:meta.frames-1);}
  function drawHero(t){
    const y=laneY[player.lane],x=W*player.x,metaSet=actorData?.hero;if(!metaSet)return;
    let action='idle',elapsed=t;
    if(player.attackClip>0){action='attack';elapsed=(metaSet.attack.duration-player.attackClip);}
    else if(player.moveClip>0){action='move';elapsed=metaSet.move.duration-player.moveClip;}
    const meta=metaSet[action],im=actorImages.hero[action],frame=animationFrame(meta,elapsed,action==='idle');
    ctx.fillStyle='#170e1b99';ctx.beginPath();ctx.ellipse(x,y+H*.045,Math.max(12,H*.035),Math.max(3,H*.012),0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#f6ca63';ctx.lineWidth=2;ctx.shadowColor='#f4bd50';ctx.shadowBlur=12;ctx.beginPath();ctx.ellipse(x,y+H*.046,Math.max(20,H*.06),Math.max(6,H*.015),0,0,Math.PI*2);ctx.stroke();ctx.shadowBlur=0;
    const alpha=player.hit>0?.72:1;
    drawStrip(meta,im,frame,x,y-H*.008,Math.min(H*.2,118),true,alpha);
    ctx.fillStyle='#ffe1a1';ctx.font=`800 ${Math.max(10,H*.021)}px system-ui`;ctx.textAlign='center';ctx.fillText('BẠN',x,y-H*.105);
    // Magic streak indicates the active attack and points toward its target.
    if(aimFlash>0){ctx.strokeStyle='#f8d27f';ctx.lineWidth=2;ctx.shadowColor='#ffb354';ctx.shadowBlur=10;ctx.beginPath();ctx.moveTo(x+H*.05,y-H*.025);ctx.lineTo(x+H*.13,y-H*.025);ctx.stroke();ctx.shadowBlur=0;}
  }
  function drawEnemy(e,t){
    const x=e.x*W,y=laneY[e.lane]+e.offset,unit=actorImages.enemies[e.kind],moveStop=structures[e.lane]?.type==='wall'?.44:.115;let action=e.x<=moveStop?'attack':'move';
    const meta=actorData?.enemies?.find(a=>a.id===e.kind)?.actions?.[action]||actorData?.enemies?.find(a=>a.id===e.kind)?.actions?.idle;
    const im=unit?.[action]||unit?.idle;const frame=animationFrame(meta,t+e.kind*.07,true);const h=Math.min(H*.2,110)*(e.boss?1.23:1);
    ctx.fillStyle='#160f1a99';ctx.beginPath();ctx.ellipse(x,y+H*.04,Math.max(12,h*.27),Math.max(3,h*.07),0,0,Math.PI*2);ctx.fill();
    drawStrip(meta,im,frame,x,y-H*.005,h,false,1);
    const bw=e.boss?56:38,bh=4,bx=x-bw/2,by=y-h*.52;ctx.fillStyle='#231922dd';pathRound(bx,by,bw,bh,2);ctx.fill();ctx.fillStyle=e.boss?'#f09362':'#efbd70';pathRound(bx,by,bw*Math.max(0,e.hp/e.max),bh,2);ctx.fill();if(e.boss){ctx.fillStyle='#ffe2aa';ctx.font='700 8px system-ui';ctx.textAlign='center';ctx.fillText('QUÁI TRÙM',x,by-4);}
  }
  function drawStructures(t){structures.forEach((s,i)=>{if(!s)return;const x=W*.44,y=laneY[i];if(s.type==='wall'){ctx.fillStyle='#694e35';pathRound(x-14,y-14,28,29,3);ctx.fill();ctx.strokeStyle='#bd9158';ctx.lineWidth=2;ctx.stroke();ctx.strokeStyle='#d5b780';ctx.beginPath();ctx.moveTo(x-12,y-5);ctx.lineTo(x+12,y-5);ctx.moveTo(x-12,y+5);ctx.lineTo(x+12,y+5);ctx.stroke();}else if(s.ready){ctx.fillStyle='#a95642';ctx.beginPath();ctx.moveTo(x-16,y+8);ctx.lineTo(x-11,y-7);ctx.lineTo(x-5,y+1);ctx.lineTo(0,y-11);ctx.lineTo(6,y+1);ctx.lineTo(12,y-7);ctx.lineTo(17,y+8);ctx.fill();ctx.strokeStyle='#e29a68';ctx.stroke();}else{ctx.fillStyle='#aa987a';ctx.font='10px system-ui';ctx.fillText('×',x-4,y+4);}});}
  function draw(){const t=performance.now()/1000;ctx.setTransform(DPR,0,0,DPR,0,0);if(shake>0){ctx.save();ctx.translate(rand(-6,6)*shake*3,rand(-4,4)*shake*3);shake=Math.max(0,shake-.016);}drawBackground(t);drawStructures(t);for(const e of enemies)drawEnemy(e,t);
    // projectiles with glow
    for(const s of shots){const x=s.x*W;ctx.save();ctx.shadowBlur=13;ctx.shadowColor='#ffd36d';ctx.strokeStyle='#f4bc55a8';ctx.lineWidth=4;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(x-16,s.y);ctx.lineTo(x,s.y);ctx.stroke();ctx.fillStyle='#fff2c3';ctx.beginPath();ctx.arc(x,s.y,4,0,Math.PI*2);ctx.fill();ctx.restore();}
    particles.forEach(p=>{ctx.globalAlpha=Math.max(.05,p.life*2.5);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,2.5,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;});drawHero(t);
    if(state==='playing'){ctx.fillStyle='#e8e3d6';ctx.font=`700 ${Math.max(9,H*.022)}px system-ui`;ctx.textAlign='left';ctx.fillText(`ĐỢT ${wave}`,W*.13,H*.08);ctx.fillStyle='#ffffff22';pathRound(W*.13,H*.1,W*.21,5,3);ctx.fill();ctx.fillStyle='#e8b855';pathRound(W*.13,H*.1,W*.21*Math.max(0,waveTime/Math.max(23,31-wave*.55)),5,3);ctx.fill();ctx.textAlign='right';ctx.fillStyle='#d4d0c5';ctx.fillText(`${playerHp} ♥`,W*.91,H*.08);}
    if(shake>0)ctx.restore();requestAnimationFrame(draw);
  }
  let prev=performance.now();function loop(now){const dt=Math.min(.04,(now-prev)/1000);prev=now;update(dt);requestAnimationFrame(loop);}requestAnimationFrame(loop);requestAnimationFrame(draw);
  $('playBtn').addEventListener('click',begin);$('upBtn').addEventListener('pointerdown',e=>{e.preventDefault();moveLane(-1);});$('downBtn').addEventListener('pointerdown',e=>{e.preventDefault();moveLane(1);});
  $('buildBtn').addEventListener('click',()=>openShop('mid'));$('continueBtn').addEventListener('click',resumeWave);document.querySelectorAll('[data-buy]').forEach(b=>b.addEventListener('click',()=>buy(b.dataset.buy)));document.querySelectorAll('[data-shop-lane]').forEach(b=>b.addEventListener('click',()=>{shopLane=Number(b.dataset.shopLane);refreshShop();}));
  $('pauseBtn').addEventListener('click',()=>{if(state==='playing'){state='paused';setOverlay('pause');}});$('resumeBtn').addEventListener('click',()=>{state='playing';setOverlay(null);});$('quitBtn').addEventListener('click',()=>{state='menu';setOverlay('start');});$('againBtn').addEventListener('click',begin);$('homeBtn').addEventListener('click',()=>{state='menu';setOverlay('start');});
  window.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown',' '].includes(e.key))e.preventDefault();if((e.key==='ArrowUp'||e.key.toLowerCase()==='w')&&moveCooldown<=0)moveLane(-1);if((e.key==='ArrowDown'||e.key.toLowerCase()==='s')&&moveCooldown<=0)moveLane(1);if(e.key==='Escape'){if(state==='playing'){$('pauseBtn').click();}else if(state==='paused')$('resumeBtn').click();}});
  document.getElementById('arena').addEventListener('pointerdown',e=>{if(e.target.closest('button')||state!=='playing')return;const r=canvas.getBoundingClientRect();const lane=Math.max(0,Math.min(2,Math.floor((e.clientY-r.top)/r.height*3)));setLane(lane);});
  (async()=>{try{await Promise.all([GameHub.init(),assetsReady]);const saved=await GameHub.load();if(saved){personalBest=Number(saved.best)||0;furthestWave=Number(saved.wave)||0;}await GameHub.ready();}catch(_){} })();
})();
