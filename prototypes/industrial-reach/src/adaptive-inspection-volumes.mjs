// Exact projection consistency after partition, source and coverage validation.
const fields=['initial_delta','remaining_delta','remaining_eligible','remaining_stock','removed'];
const integer=v=>{
 if(typeof v==='bigint')return v;
 if(typeof v==='number'&&Number.isSafeInteger(v))return BigInt(v);
 throw Error('Inspection volume requires exact integers.');
};
const gcd=(a,b)=>{while(b){const r=a%b;a=b;b=r;}return a;};
function rational(value){
 if(!Array.isArray(value)||value.length!==2)throw Error('Inspection volume rational differs.');
 const n=integer(value[0]),d=integer(value[1]);
 if(n<0n||d<=0n||gcd(n,d)!==1n)throw Error('Inspection volume rational is not canonical.');
 return [n,d];
}
function fraction(n,d){const g=gcd(n,d);return [n/g,d/g];}

export function inspectionVolumeSummary(frame,root){
 const [n,d]=rational(root.side);if(n===0n)throw Error('Inspection root side must be positive.');
 const sums=Object.fromEntries(fields.map(k=>[k,[0n,0n]]));
 if(!Array.isArray(frame.domain?.leaves)||!Array.isArray(frame.coverage)||frame.domain.leaves.length!==frame.coverage.length)throw Error('Inspection volume cell counts differ.');
 for(let i=0;i<frame.domain.leaves.length;i++){
  const leaf=frame.domain.leaves[i],depth=leaf.address?.depth,coverage=frame.coverage[i];
  if(!Number.isInteger(depth)||depth<0||depth>20||!Array.isArray(coverage)||coverage.length!==2||coverage.some(v=>typeof v!=='boolean')||coverage[0]&&!coverage[1]||!['delta_lower','delta_upper','eligible_lower','eligible_upper'].every(k=>typeof leaf[k]==='boolean')||!['inside','outside','mixed_or_unresolved'].includes(leaf.stock))throw Error('Inspection volume predicates differ.');
  const units=1n<<BigInt(3*(20-depth)),[removedLower,removedUpper]=coverage;
  const add=(name,lo,hi)=>{if(lo)sums[name][0]+=units;if(hi)sums[name][1]+=units;};
  add('initial_delta',leaf.delta_lower,leaf.delta_upper);
  add('remaining_delta',leaf.delta_lower&&!removedUpper,leaf.delta_upper&&!removedLower);
  add('remaining_eligible',leaf.eligible_lower&&!removedUpper,leaf.eligible_upper&&!removedLower);
  add('remaining_stock',leaf.stock==='inside'&&!removedUpper,leaf.stock!=='outside'&&!removedLower);
  add('removed',removedLower,removedUpper);
 }
 const numerator=n**3n,denominator=d**3n*(1n<<60n);
 return Object.fromEntries(fields.map(name=>[name,{lower_mm3:fraction(sums[name][0]*numerator,denominator),upper_mm3:fraction(sums[name][1]*numerator,denominator)}]));
}

export function verifyInspectionVolumes(frame,root){
 const volumes=frame.volumes;
 if(!volumes||typeof volumes!=='object'||Array.isArray(volumes)||Object.keys(volumes).sort().join(',')!==[...fields].sort().join(','))throw Error('Inspection volume fields differ.');
 const expected=inspectionVolumeSummary(frame,root);
 for(const name of fields){
  const row=volumes[name];
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).sort().join(',')!=='lower_mm3,upper_mm3')throw Error('Inspection volume interval fields differ.');
  for(const bound of ['lower_mm3','upper_mm3']){
   const value=rational(row[bound]),match=expected[name][bound];
   if(value[0]!==match[0]||value[1]!==match[1])throw Error('Inspection volume disagrees with recorded cells: '+name+'.'+bound);
  }
 }
}
