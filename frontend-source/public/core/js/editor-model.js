export const capabilities={admin:['layout','configure','simulate'],operator:['simulate'],reader:[]};
export const can=(role,action)=>(capabilities[role]||[]).includes(action);
export const fresh=()=>({version:1,nodes:[],edges:[],background:'#101827',grid:true,zoom:1,pan:{x:40,y:40}});
export function connectGraph(graph,from,to){
  if(from===to||!graph.nodes.some(n=>n.id===from)||!graph.nodes.some(n=>n.id===to))throw Error('İki farklı öğe seç.');
  if(graph.edges.some(e=>e.from===from&&e.to===to))throw Error('Bağlantı zaten var.');
  const visit=(id,seen=new Set())=>{if(id===from)return true;if(seen.has(id))return false;seen.add(id);return graph.edges.filter(e=>e.from===id).some(e=>visit(e.to,seen));};
  if(visit(to))throw Error('Döngü oluşturan bağlantı eklenemez.');
  graph.edges.push({id:crypto.randomUUID(),from,to});
}
export function validateGraph(g){
  if(g?.version!==1||!Array.isArray(g.nodes)||!Array.isArray(g.edges)||g.nodes.length>2000||g.edges.length>10000)throw Error('Geçersiz şema; en fazla 2000 öğe.');
  const ids=new Set();for(const n of g.nodes){if(typeof n.id!=='string'||ids.has(n.id)||typeof n.label!=='string'||!['INVERTER','DM','TM','TRAFO','ADP','GRID','GROUP','DEVICE'].includes(n.type)||![n.x,n.y,n.w,n.h].every(Number.isFinite)||n.w<80||n.w>2000||n.h<70||n.h>2000)throw Error('Geçersiz öğe veya boyut.');ids.add(n.id);}
  const checked={nodes:g.nodes,edges:[]};for(const e of g.edges){if(typeof e.id!=='string'||!ids.has(e.from)||!ids.has(e.to)||e.from===e.to)throw Error('Geçersiz bağlantı.');connectGraph(checked,e.from,e.to);}
  if(!/^#[0-9a-f]{6}$/i.test(g.background))g.background='#101827';
  return {...fresh(),...g,zoom:1,pan:{x:40,y:40}};
}
export function edgeStatus(graph,edge,status){
  const upstream=(id,seen=new Set())=>{if(seen.has(id))return false;seen.add(id);const n=graph.nodes.find(n=>n.id===id);return n?.isolated||graph.edges.filter(e=>e.to===id).some(e=>upstream(e.from,seen));};
  if(upstream(edge.from)||upstream(edge.to))return 'scenario';
  const a=status(graph.nodes.find(n=>n.id===edge.from)),b=status(graph.nodes.find(n=>n.id===edge.to));
  if(a==='flowing'&&b==='flowing')return 'flowing';
  if(['bad','stale','partial'].includes(a)||['bad','stale','partial'].includes(b))return 'stale';
  return 'unknown';
}
