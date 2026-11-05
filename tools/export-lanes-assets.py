"""Export the licensed Unity character prefabs and clips as browser sprite strips.

Run from this checkout with Pillow installed. The source pack must be present next
to gamehub; it is intentionally not included in the repository.
"""
from PIL import Image
from pathlib import Path
import re,os,math,json
project=Path(__file__).resolve().parents[1]
root=str(project.parent/'Blackthornprod'/'100 Fantasy Characters Pack')
out=str(project/'seed-games'/'lanes-of-valor'/'assets')
Path(out).mkdir(parents=True,exist_ok=True)
atlas=Image.open(root+'/Sprites/characters.png').convert('RGBA'); meta=open(root+'/Sprites/characters.png.meta').read(); PPU=100
sprites={}
for b in re.finditer(r'^    - serializedVersion: 2\n      name: (characters_\d+)(.*?)(?=^    - serializedVersion: 2|\Z)',meta,re.M|re.S):
 name,tail=b.groups(); rect=re.search(r'\n        x: (\d+)\n        y: (\d+)\n        width: (\d+)\n        height: (\d+)',tail); fid=re.search(r'\n      internalID: (-?\d+)',tail); pivot=re.search(r'\n      pivot: \{x: ([^,]+), y: ([^}]+)',tail)
 if rect and fid and pivot:
  x,y,w,h=map(int,rect.groups());sprites[int(fid.group(1))]=(name,(x,atlas.height-y-h,x+w,atlas.height-y),tuple(map(float,pivot.groups())))

def parse_prefab(num):
 path=f'{root}/Prefabs/Character ({num}).prefab'; data=open(path).read(); docs=re.split(r'(?=--- !u!)',data)
 go_names={}; go_to_tr={}; tr={}; render=[]
 for d in docs:
  h=re.match(r'--- !u!\d+ &(\d+)',d)
  if not h:continue
  oid=int(h.group(1))
  if '\nGameObject:' in d:
   n=re.search(r'  m_Name: (.+)',d); go_names[oid]=n.group(1).strip() if n else ''
  if '\nTransform:' in d:
   g=re.search(r'  m_GameObject: \{fileID: (\d+)',d);p=re.search(r'  m_LocalPosition: \{x: ([^,]+), y: ([^,]+), z: ([^}]+)',d);sc=re.search(r'  m_LocalScale: \{x: ([^,]+), y: ([^,]+), z: ([^}]+)',d);fa=re.search(r'  m_Father: \{fileID: (\d+)',d)
   if g and p and sc:
    gid=int(g.group(1));go_to_tr[gid]=oid;tr[oid]={'gid':gid,'name':go_names.get(gid,''),'pos':list(map(float,p.groups())),'scale':list(map(float,sc.groups())),'father':int(fa.group(1)) if fa else 0}
  if '\nSpriteRenderer:' in d:
   g=re.search(r'  m_GameObject: \{fileID: (\d+)',d);sp=re.search(r'  m_Sprite: \{fileID: (-?\d+)',d);order=re.search(r'  m_SortingOrder: (-?\d+)',d);flip=re.search(r'  m_FlipX: (\d+)',d)
   if g and sp and order:render.append({'gid':int(g.group(1)),'sprite':int(sp.group(1)),'order':int(order.group(1)),'flip':bool(int(flip.group(1))) if flip else False})
 for tid,node in tr.items():node['name']=go_names.get(node['gid'],'')
 path_nodes={}
 def path_for(tid):
  n=tr[tid]; fa=n['father']
  if fa and fa in tr:
   parent=path_for(fa)
   return parent+'/'+n['name'] if parent else n['name']
  return ''
 for tid,n in tr.items():path_nodes[path_for(tid)]=tid
 return tr,path_nodes,render,go_to_tr

def parse_clip(animfile):
 text=open(animfile).read(); stop=re.search(r'm_StopTime: ([\d.]+)',text);dur=float(stop.group(1)) if stop else .6;tracks={}
 for typ in ['EulerCurves','PositionCurves','ScaleCurves']:
  m=re.search(r'^  m_'+typ+r':\n(.*?)(?=^  m_\w+Curves:|^  m_\w+Curves: \[|\Z)',text,re.M|re.S)
  if not m:continue
  block=m.group(1)
  for c in re.finditer(r'  - curve:\n(.*?)(?=\n  - curve:|\Z)',block,re.S):
   part=c.group(1); pathm=re.search(r'\n    path: (.*)',part)
   if not pathm:continue
   p=pathm.group(1).strip(); curve=re.search(r'\n      m_Curve:\n(.*?)(?=\n      m_PreInfinity:|\Z)',part,re.S)
   if not curve:continue
   keys=[]
   for k in re.finditer(r'        time: ([\d.eE+-]+)\n        value: \{x: ([\d.eE+-]+), y: ([\d.eE+-]+), z: ([\d.eE+-]+)\}',curve.group(1)):
    keys.append([float(k.group(1)),float(k.group(2)),float(k.group(3)),float(k.group(4))])
   if keys:tracks.setdefault(p,{})[{'EulerCurves':'rot','PositionCurves':'pos','ScaleCurves':'scale'}[typ]]=keys
 return dur,tracks

def eval_curve(keys,t):
 if t<=keys[0][0]:return keys[0][1:]
 if t>=keys[-1][0]:return keys[-1][1:]
 for a,b in zip(keys,keys[1:]):
  if a[0]<=t<=b[0]:
   q=(t-a[0])/(b[0]-a[0] or 1);return [a[i]+(b[i]-a[i])*q for i in range(1,4)]
 return keys[-1][1:]

def pose(tr,path_nodes,tracks,t):
 local={}
 for path,props in tracks.items():
  tid=path_nodes.get(path)
  if tid is None:continue
  local[tid]={k:eval_curve(v,t) for k,v in props.items()}
 cache={}
 def world(tid):
  if tid in cache:return cache[tid]
  n=tr[tid];v=local.get(tid,{})
  pos=v.get('pos',n['pos']);scale=v.get('scale',n['scale']);rot=v.get('rot',[0,0,0])[2]
  fa=n['father']
  if fa and fa in tr:
   px,py,psx,psy,pr=world(fa);ang=math.radians(pr);lx=pos[0]*psx;ly=pos[1]*psy
   x=px+lx*math.cos(ang)-ly*math.sin(ang);y=py+lx*math.sin(ang)+ly*math.cos(ang)
   out=(x,y,psx*scale[0],psy*scale[1],pr+rot)
  else:out=(pos[0],pos[1],scale[0],scale[1],rot)
  cache[tid]=out;return out
 return {gid:world(tid) for gid,tid in go_to_tr.items()} if False else cache,world

def frame_actor(num, animfile, frame_count=8, cell=(192,192)):
 tr,path_nodes,render,go_to_tr=parse_prefab(num);dur,tracks=parse_clip(animfile)
 # path -> id tracking includes all animated target transform IDs
 frames=[]
 for fi in range(frame_count):
  t=dur*fi/frame_count
  local={}
  for p,props in tracks.items():
   tid=path_nodes.get(p)
   if tid is not None:local[tid]={k:eval_curve(v,t) for k,v in props.items()}
  cache={}
  def world(tid):
   if tid in cache:return cache[tid]
   n=tr[tid];v=local.get(tid,{})
   pos=v.get('pos',n['pos']);scale=v.get('scale',n['scale']);rot=v.get('rot',[0,0,0])[2];fa=n['father']
   if fa and fa in tr:
    px,py,psx,psy,pr=world(fa);a=math.radians(pr);lx=pos[0]*psx;ly=pos[1]*psy;out=(px+lx*math.cos(a)-ly*math.sin(a),py+lx*math.sin(a)+ly*math.cos(a),psx*scale[0],psy*scale[1],pr+rot)
   else:out=(pos[0],pos[1],scale[0],scale[1],rot)
   cache[tid]=out;return out
  layers=[]
  for r in render:
   tid=go_to_tr.get(r['gid']);fid=r['sprite']
   if tid is None or fid not in sprites:continue
   wx,wy,sx,sy,angle=world(tid);name,rect,pivot=sprites[fid];crop=atlas.crop(rect);ww=crop.width/PPU*abs(sx);hh=crop.height/PPU*abs(sy)
   left=wx-pivot[0]*ww;bottom=wy-pivot[1]*hh;right=left+ww;top=bottom+hh;layers.append((r,wx,wy,sx,sy,angle,rect,pivot,(left,bottom,right,top)))
  frames.append(layers)
 # shared art bounds over all frames
 b=[1e9,-1e9,1e9,-1e9]
 for layers in frames:
  for L in layers:
   bb=L[-1];b=[min(b[0],bb[0]),max(b[1],bb[2]),min(b[2],bb[1]),max(b[3],bb[3])]
 # give margin and fit world units to 150px height
 margin=.12;minx,miny,maxx,maxy=b[0]-margin,b[2]-margin,b[1]+margin,b[3]+margin
 world_w=maxx-minx;world_h=maxy-miny;pxpu=min((cell[0]-12)/world_w,(cell[1]-12)/world_h)
 strip=Image.new('RGBA',(cell[0]*frame_count,cell[1]),(0,0,0,0))
 for fi,layers in enumerate(frames):
  frame=Image.new('RGBA',cell,(0,0,0,0));baseX=(cell[0]-world_w*pxpu)/2;baseY=(cell[1]-world_h*pxpu)/2
  for r,wx,wy,sx,sy,angle,rect,pivot,bb in sorted(layers,key=lambda L:L[0]['order']):
   crop=atlas.crop(rect).resize((max(1,round((rect[2]-rect[0])/PPU*abs(sx)*pxpu)),max(1,round((rect[3]-rect[1])/PPU*abs(sy)*pxpu))))
   if r['flip']:crop=crop.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
   pp=(pivot[0]*crop.width,(1-pivot[1])*crop.height);rotated=crop.rotate(angle,resample=Image.Resampling.BICUBIC,expand=True)
   # pivot location is transformed about the image center during PIL rotate
   cx,cy=crop.width/2,crop.height/2;rx,ry=pp[0]-cx,pp[1]-cy;ra=math.radians(angle);rpx=cx+rx*math.cos(ra)+ry*math.sin(ra);rpy=cy-rx*math.sin(ra)+ry*math.cos(ra)
   anchorX=baseX+(wx-minx)*pxpu;anchorY=baseY+(maxy-wy)*pxpu
   frame.alpha_composite(rotated,(round(anchorX-rpx),round(anchorY-rpy)))
  strip.alpha_composite(frame,(fi*cell[0],0))
 return strip,{'frames':frame_count,'width':cell[0],'height':cell[1],'ratio':world_w/world_h,'duration':dur}

# Character 100 is the pack's articulated red sword bearer; export its actual Animator clips.
animdir=root+'/Animations/Character Anims (10)'; manifest={'hero':{'prefab':95,'animationSet':100},'enemies':[]}
for action in ['idle','move','attack']:
 file=f'{animdir}/{action}.anim';img,metaout=frame_actor(95,file,12,(192,192));path=f'{out}/hero-{action}.png';img.save(path,optimize=True);manifest['hero'][action]=dict(metaout,file=f'hero-{action}.png')
# Animated enemy prefab variants from the pack; each retains its own sprite hierarchy.
for num,folder in [(70,7),(80,8),(41,5),(51,6),(31,4),(21,3),(11,2)]:
 animdir=f'{root}/Animations/Character Anims ({folder})'; info={'id':num,'actions':{}}
 for action in ['idle','move','attack']:
  file=f'{animdir}/{action}.anim'
  if not os.path.exists(file):continue
  img,metaout=frame_actor(num,file,8,(192,192));fn=f'monster-{num}-{action}.png';img.save(f'{out}/{fn}',optimize=True);info['actions'][action]=dict(metaout,file=fn)
 manifest['enemies'].append(info)
with open(f'{out}/actors.json','w') as f:json.dump(manifest,f,separators=(',',':'))
# Keep exact painted environment from the provided pack.
Image.open(root+'/Sprites/bg9.png').convert('RGB').save(f'{out}/background.png',optimize=True)
print('exported',len(manifest['enemies']),'enemy rigs, hero clips',list(manifest['hero']))
