// Small, deterministic geometry layer shared by combat, navigation and tests.
export const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

export function circleRect(circle,rect,padding=0){
 const radius=(circle.r??0)+padding;
 const x=clamp(circle.x,rect.x,rect.x+rect.w),y=clamp(circle.y,rect.y,rect.y+rect.h);
 return (circle.x-x)**2+(circle.y-y)**2<radius*radius-1e-7;
}

export function segmentRect(a,b,rect,padding=0){
 return segmentRectTime(a,b,rect,padding)!==null;
}

// The first normalized intersection time, including a start inside the rectangle.
export function segmentRectTime(a,b,rect,padding=0){
 const dx=b.x-a.x,dy=b.y-a.y;
 let near=0,far=1;
 for(const [start,delta,min,max] of [[a.x,dx,rect.x-padding,rect.x+rect.w+padding],[a.y,dy,rect.y-padding,rect.y+rect.h+padding]]){
  if(Math.abs(delta)<1e-12){if(start<min||start>max)return null;continue;}
  let t1=(min-start)/delta,t2=(max-start)/delta;
  if(t1>t2)[t1,t2]=[t2,t1];
  near=Math.max(near,t1);far=Math.min(far,t2);
  if(near>far)return null;
 }
 return near>=0&&near<=1?near:null;
}

export function movementObstacles(level,options={}){
 const result=(level.walls||[]).filter(w=>w.active!==false&&!(w.hp!==undefined&&w.hp<=0));
 if(options.ignoreCovers!==true)result.push(...(level.covers||[]).filter(c=>c.active!==false&&!(c.hp!==undefined&&c.hp<=0)&&!(options.ignoreCovers==='low'&&c.low!==false)));
 if(!options.ignoreDoors)result.push(...(level.doors||[]).filter(d=>!d.open&&d.active!==false&&!(d.hp!==undefined&&d.hp<=0)));
 return result;
}

export function lineOfSight(a,b,level,options={}){
 const obstacles=(level.walls||[]).filter(w=>w.active!==false&&!(w.hp!==undefined&&w.hp<=0)&&!(options.ignoreGlass&&w.material==='glass'));
 obstacles.push(...(level.doors||[]).filter(d=>!d.open&&d.active!==false&&!(d.hp!==undefined&&d.hp<=0)));
 if(options.highCover!==false)obstacles.push(...(level.covers||[]).filter(c=>c.low===false&&c.active!==false&&!(c.hp!==undefined&&c.hp<=0)));
 return !obstacles.some(o=>segmentRect(a,b,o,options.padding||0));
}

export function pointWalkable(point,level,r=16,options={}){
 if(point.x<r||point.y<r||point.x>level.width-r||point.y>level.height-r)return false;
 return !movementObstacles(level,options).some(rect=>circleRect({...point,r},rect));
}

// Sub-stepping prevents dashes and low-frame-rate movement tunnelling through walls.
// Axis separation permits predictable wall sliding rather than sticky corners.
export function moveActor(actor,dx,dy,level,options={}){
 const radius=actor.r??16,steps=Math.max(1,Math.ceil(Math.hypot(dx,dy)/Math.max(6,radius*.65)));
 const obstacles=movementObstacles(level,options),stepX=dx/steps,stepY=dy/steps;
 let moved=false;
 for(let i=0;i<steps;i++){
  const nextX=clamp(actor.x+stepX,radius,level.width-radius);
  const xCircle={x:nextX,y:actor.y,r:radius};
  if(!obstacles.some(rect=>circleRect(xCircle,rect))){moved||=nextX!==actor.x;actor.x=nextX;}
  const nextY=clamp(actor.y+stepY,radius,level.height-radius);
  const yCircle={x:actor.x,y:nextY,r:radius};
  if(!obstacles.some(rect=>circleRect(yCircle,rect))){moved||=nextY!==actor.y;actor.y=nextY;}
 }
 return moved;
}

function pointSegmentDistanceSquared(x,y,a,b){
 const dx=b.x-a.x,dy=b.y-a.y,lengthSquared=dx*dx+dy*dy;
 const t=lengthSquared>0?clamp(((x-a.x)*dx+(y-a.y)*dy)/lengthSquared,0,1):0;
 return (x-a.x-dx*t)**2+(y-a.y-dy*t)**2;
}

function pointRectDistanceSquared(point,rect){
 const dx=point.x-clamp(point.x,rect.x,rect.x+rect.w),dy=point.y-clamp(point.y,rect.y,rect.y+rect.h);
 return dx*dx+dy*dy;
}

// Exact swept-circle collision against an axis-aligned rectangle. A padded AABB
// is only a broad phase: its square corners are not solid parts of the rounded
// Minkowski sum. Treating them as solid traps legally positioned circular actors
// at corners, even though moveActor's circle collision lets them stand there.
export function sweptCircleRect(a,b,rect,r=0){
 // Most navigation edges are far from most map rectangles. Reject those with
 // scalar bounds before the more expensive slab and rounded-corner checks.
 if(Math.max(a.x,b.x)+r<rect.x||Math.min(a.x,b.x)-r>rect.x+rect.w||Math.max(a.y,b.y)+r<rect.y||Math.min(a.y,b.y)-r>rect.y+rect.h)return false;
 if(!segmentRect(a,b,rect,r))return false;
 if(r<=0||segmentRect(a,b,rect))return true;
 const threshold=r*r-1e-7;
 if(pointRectDistanceSquared(a,rect)<threshold||pointRectDistanceSquared(b,rect)<threshold)return true;
 for(const x of [rect.x,rect.x+rect.w])for(const y of [rect.y,rect.y+rect.h]){
  if(pointSegmentDistanceSquared(x,y,a,b)<threshold)return true;
 }
 return false;
}

function clearTravel(a,b,obstacles,r){
 return !obstacles.some(o=>sweptCircleRect(a,b,o,r));
}

// A* over a 48-pixel navigation lattice. Every returned segment is collision checked.
// Door state is sampled on each request, so opening a route never leaves stale nav data.
export function findPath(start,end,level,r=16,options={}){
 const obstacles=movementObstacles(level,options);
 if(clearTravel(start,end,obstacles,r)&&pointWalkable(end,level,r,options))return[{x:end.x,y:end.y}];
 const cell=48,columns=Math.ceil(level.width/cell),rows=Math.ceil(level.height/cell);
 const index=(x,y)=>y*columns+x;
 const valid=new Int8Array(columns*rows);
 const world=(x,y)=>({x:clamp((x+.5)*cell,r+1,level.width-r-1),y:clamp((y+.5)*cell,r+1,level.height-r-1)});
 const walkable=(x,y)=>{
  if(x<0||y<0||x>=columns||y>=rows)return false;
  const n=index(x,y);if(valid[n])return valid[n]===1;
  const point=world(x,y),ok=!obstacles.some(o=>circleRect({...point,r:r+2},o));valid[n]=ok?1:-1;return ok;
 };
 function nearest(point){
  const cx=clamp(Math.floor(point.x/cell),0,columns-1),cy=clamp(Math.floor(point.y/cell),0,rows-1);
  for(let ring=0;ring<12;ring++){
   let best=null,bestD=Infinity;
   for(let y=cy-ring;y<=cy+ring;y++)for(let x=cx-ring;x<=cx+ring;x++){
    if(ring&&x!==cx-ring&&x!==cx+ring&&y!==cy-ring&&y!==cy+ring)continue;
    if(!walkable(x,y))continue;const p=world(x,y),d=distance(point,p);
    if(d<bestD&&clearTravel(point,p,obstacles,r)){best={x,y};bestD=d;}
   }
   if(best)return best;
  }
  return null;
 }
 const from=nearest(start),to=nearest(end);if(!from||!to)return[];
 const total=columns*rows,gScore=new Float64Array(total);gScore.fill(Infinity);
 const parents=new Int32Array(total);parents.fill(-1);const closed=new Uint8Array(total);
 const heap=[];
 function push(item){heap.push(item);let n=heap.length-1;while(n>0){const p=(n-1)>>1;if(heap[p].f<=item.f)break;heap[n]=heap[p];n=p;}heap[n]=item;}
 function pop(){const best=heap[0],last=heap.pop();if(heap.length){let n=0;while(true){let child=n*2+1;if(child>=heap.length)break;if(child+1<heap.length&&heap[child+1].f<heap[child].f)child++;if(heap[child].f>=last.f)break;heap[n]=heap[child];n=child;}heap[n]=last;}return best;}
 const startN=index(from.x,from.y),endN=index(to.x,to.y);gScore[startN]=0;
 push({x:from.x,y:from.y,n:startN,f:Math.hypot(from.x-to.x,from.y-to.y)});
 let found=false,iterations=0;
 while(heap.length&&iterations++<20000){
  const current=pop();if(closed[current.n])continue;closed[current.n]=1;
  if(current.n===endN){found=true;break;}
  for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){
   const x=current.x+dx,y=current.y+dy;if(!walkable(x,y))continue;
   if(dx&&dy&&(!walkable(current.x+dx,current.y)||!walkable(current.x,current.y+dy)))continue;
   const n=index(x,y);if(closed[n])continue;
   if(!clearTravel(world(current.x,current.y),world(x,y),obstacles,r))continue;
   const tentative=gScore[current.n]+(dx&&dy?Math.SQRT2:1);
   if(tentative>=gScore[n])continue;
   gScore[n]=tentative;parents[n]=current.n;push({x,y,n,f:tentative+Math.hypot(x-to.x,y-to.y)});
  }
 }
 if(!found)return[];
 const path=[];let n=endN;
 while(n!==startN&&n>=0){path.push(world(n%columns,Math.floor(n/columns)));n=parents[n];}
 path.reverse();
 // Keep the certified initial connection. The actual start need not have direct
 // line clearance to the grid's *second* point when it is tangent to a corner.
 if(distance(start,world(from.x,from.y))>1e-7)path.unshift(world(from.x,from.y));
 if(pointWalkable(end,level,r,options)&&clearTravel(path[path.length-1]||start,end,obstacles,r))path.push({x:end.x,y:end.y});
 const smooth=[];let anchor=start,i=0;
 while(i<path.length){let far=i;while(far+1<path.length&&clearTravel(anchor,path[far+1],obstacles,r))far++;smooth.push(path[far]);anchor=path[far];i=far+1;}
 return smooth;
}
