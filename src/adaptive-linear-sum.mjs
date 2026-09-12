// Shared exact summation of up to 54 rounded binary64 score products.
const fail=message=>{throw new Error(message);};
const bits=new DataView(new ArrayBuffer(8));
const fractionMask=(1n<<52n)-1n;

export function binary64ScoreSum(terms){
  if(!Array.isArray(terms)||terms.length>54||Array.from(terms).some(v=>typeof v!=='number'||!Number.isFinite(v)))fail('Invalid finite score terms.');
  let total=0n;const partials=[];
  for(const term of terms){
    let x=term,index=0;
    for(let y of partials){
      if(Math.abs(x)<Math.abs(y))[x,y]=[y,x];
      const high=x+y,low=y-(high-x);
      if(!Number.isFinite(high))fail('Score accumulation overflow.');
      if(low!==0)partials[index++]=low;
      x=high;
    }
    partials.length=index;if(x!==0)partials.push(x);
    bits.setFloat64(0,term,false);const raw=bits.getBigUint64(0,false);
    const exponent=Number((raw>>52n)&2047n),fraction=raw&fractionMask;
    const units=exponent===0?fraction:((1n<<52n)|fraction)<<BigInt(exponent-1);
    total+=(raw>>63n)?-units:units;
  }
  if(total===0n)return 0;
  const sign=total<0n?1n<<63n:0n;let magnitude=total<0n?-total:total;
  if(magnitude<(1n<<52n)){
    bits.setBigUint64(0,sign|magnitude,false);return bits.getFloat64(0,false);
  }
  let shift=Math.max(0,magnitude.toString(2).length-53),mantissa=magnitude>>BigInt(shift);
  if(shift){
    const remainder=magnitude-(mantissa<<BigInt(shift)),half=1n<<BigInt(shift-1);
    if(remainder>half||(remainder===half&&(mantissa&1n)))mantissa++;
    if(mantissa===(1n<<53n)){mantissa>>=1n;shift++;}
  }
  const exponent=shift+1;if(exponent>=2047)fail('Score accumulation overflow.');
  bits.setBigUint64(0,sign|(BigInt(exponent)<<52n)|(mantissa-(1n<<52n)),false);
  return bits.getFloat64(0,false);
}
