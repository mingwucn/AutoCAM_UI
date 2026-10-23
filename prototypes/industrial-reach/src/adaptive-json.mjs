const fail=message=>{throw new Error(message);};

export function parseAdaptiveJson(text){
  if(typeof text!=='string'||text.length>64*1024*1024)fail('Invalid adaptive JSON input.');
  let offset=0;
  const whitespace=()=>{while(/[ \t\r\n]/.test(text[offset]||'x'))offset++;};
  function string(){
    const start=offset++;
    while(offset<text.length){
      const ch=text[offset++];
      if(ch==='"')return JSON.parse(text.slice(start,offset));
      if(ch==='\\')offset++;
    }
    fail('Unterminated adaptive JSON string.');
  }
  function value(depth){
    if(depth>192)fail('Adaptive JSON nesting exceeds the reader profile.');
    whitespace();const ch=text[offset];
    if(ch==='"')return string();
    if(ch==='['){
      offset++;whitespace();const result=[];
      if(text[offset]===']'){offset++;return result;}
      while(true){result.push(value(depth+1));whitespace();const separator=text[offset++];if(separator===']')return result;if(separator!==',')fail('Invalid adaptive JSON array.');}
    }
    if(ch==='{'){
      offset++;whitespace();const result=Object.create(null);
      if(text[offset]==='}'){offset++;return result;}
      while(true){
        whitespace();if(text[offset]!=='"')fail('Invalid adaptive JSON object key.');
        const key=string();if(Object.hasOwn(result,key))fail('Duplicate adaptive JSON key.');
        whitespace();if(text[offset++]!==':')fail('Invalid adaptive JSON object.');
        result[key]=value(depth+1);whitespace();const separator=text[offset++];
        if(separator==='}')return result;if(separator!==',')fail('Invalid adaptive JSON object.');
      }
    }
    for(const [token,result] of [['true',true],['false',false],['null',null]]){
      if(text.startsWith(token,offset)){offset+=token.length;return result;}
    }
    const match=/-?(?:0|[1-9][0-9]*)/y;match.lastIndex=offset;const found=match.exec(text);
    if(!found||found[0].length>4097)fail('Invalid or oversized adaptive JSON integer.');
    offset=match.lastIndex;const integer=BigInt(found[0]);
    return integer>=BigInt(Number.MIN_SAFE_INTEGER)&&integer<=BigInt(Number.MAX_SAFE_INTEGER)?Number(integer):integer;
  }
  const result=value(0);whitespace();if(offset!==text.length)fail('Trailing or noninteger adaptive JSON input.');return result;
}

export function canonicalAdaptive(value,pretty=false){
  const encode=(v,depth)=>{
    if(depth>192)fail('Adaptive JSON nesting exceeds the reader profile.');
    if(v===null||typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);
    if(typeof v==='number'){if(!Number.isSafeInteger(v))fail('Unsupported exact integer in adaptive bundle.');return String(v);}
    if(typeof v==='bigint'){const digits=v.toString();if(digits.length>4097)fail('Oversized exact integer in adaptive bundle.');return digits;}
    const group=(open,close,items)=>!items.length?open+close:pretty?open+'\n'+'  '.repeat(depth+1)+items.join(',\n'+'  '.repeat(depth+1))+'\n'+'  '.repeat(depth)+close:open+items.join(',')+close;
    if(Array.isArray(v))return group('[',']',v.map(x=>encode(x,depth+1)));
    if(v&&typeof v==='object')return group('{','}',Object.keys(v).sort().map(k=>JSON.stringify(k)+(pretty?': ':':')+encode(v[k],depth+1)));
    fail('Invalid adaptive record.');
  };
  return encode(value,0).replace(/[^\x00-\x7f]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
}
