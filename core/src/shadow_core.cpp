#include "shadow_core.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <new>
#include <vector>

namespace {
using V=std::array<double,3>; constexpr double eps=1e-9;
double dot(const V&a,const V&b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
V cross(const V&a,const V&b){return {a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]};}
double norm(const V&a){return std::sqrt(dot(a,a));}
V unit(V a){double n=norm(a);if(!(n>0)||!std::isfinite(n))return {0,0,0};for(double&x:a)x/=n;return a;}
V sub(const V&a,const V&b){return {a[0]-b[0],a[1]-b[1],a[2]-b[2]};}
V scale(const V&a,double s){return {a[0]*s,a[1]*s,a[2]*s};}
size_t cell_count(const sg_grid&g){return size_t(g.nx)*g.ny*g.nz;}
bool valid(const sg_grid*g,const uint8_t*s,const uint8_t*t,const uint8_t*h,const uint8_t*l,uint8_t*out){return g&&s&&t&&h&&l&&out&&g->nx&&g->ny&&g->nz&&g->pitch_mm>0&&std::isfinite(g->pitch_mm)&&cell_count(*g)<=4000000;}
V point(const sg_grid&g,size_t i){size_t yz=size_t(g.ny)*g.nz,x=i/yz,r=i%yz,y=r/g.nz,z=r%g.nz;return {g.origin_mm[0]+(x+.5)*g.pitch_mm,g.origin_mm[1]+(y+.5)*g.pitch_mm,g.origin_mm[2]+(z+.5)*g.pitch_mm};}
std::array<V,8> corners(const sg_grid&g){std::array<V,8> c{};int k=0;for(int x=0;x<2;x++)for(int y=0;y<2;y++)for(int z=0;z<2;z++)c[k++]={g.stock_bounds_mm[x?3:0],g.stock_bounds_mm[y?4:1],g.stock_bounds_mm[z?5:2]};return c;}
void base(size_t i,const uint8_t*t,const uint8_t*h,const uint8_t*l,uint8_t*out,sg_counts*c){if(!l[i])out[i]=SG_AIR;else if(t[i]){out[i]=SG_TARGET;if(c)c->target_voxels++;}else if(h[i]){out[i]=SG_HOLDING;if(c)c->holding_voxels++;}else out[i]=SG_AIR;}
}

extern "C" {
uint32_t sg_api_version(void){return 1;}
const char* sg_status_message(int s){switch(s){case SG_OK:return "ok";case SG_INVALID_ARGUMENT:return "invalid argument";case SG_LIMIT_EXCEEDED:return "grid limit exceeded";default:return "internal error";}}

int sg_milling_classify(const sg_grid*g,const uint8_t*stock,const uint8_t*target,const uint8_t*holding,const uint8_t*live,const double raw[3],double reach,uint8_t*out,sg_counts*count){
 if(!valid(g,stock,target,holding,live,out)||!raw||!(reach>0)||!std::isfinite(reach))return SG_INVALID_ARGUMENT;
 try{V d=unit({raw[0],raw[1],raw[2]});if(norm(d)==0)return SG_INVALID_ARGUMENT;int ref=0;if(std::abs(d[1])<std::abs(d[ref]))ref=1;if(std::abs(d[2])<std::abs(d[ref]))ref=2;V e={0,0,0};e[ref]=1;V u=unit(cross(e,d)),v=cross(d,u);double h=g->pitch_mm,hu=h*.5*(std::abs(u[0])+std::abs(u[1])+std::abs(u[2])),hv=h*.5*(std::abs(v[0])+std::abs(v[1])+std::abs(v[2])),hd=h*.5*(std::abs(d[0])+std::abs(d[1])+std::abs(d[2]));
  auto cs=corners(*g);double minU=INFINITY,minV=INFINITY,maxU=-INFINITY,maxV=-INFINITY,entry=INFINITY;for(auto&p:cs){minU=std::min(minU,dot(p,u));maxU=std::max(maxU,dot(p,u));minV=std::min(minV,dot(p,v));maxV=std::max(maxV,dot(p,v));entry=std::min(entry,dot(p,d));}
  size_t n=cell_count(*g);std::vector<V> pp;for(size_t i=0;i<n;i++)if(target[i]||(holding[i]&&stock[i])){V p=point(*g,i);pp.push_back(p);minU=std::min(minU,dot(p,u)-hu);maxU=std::max(maxU,dot(p,u)+hu);minV=std::min(minV,dot(p,v)-hv);maxV=std::max(maxV,dot(p,v)+hv);}if(pp.empty())return SG_INVALID_ARGUMENT;
  double lu=std::floor(minU/h)*h-h,lv=std::floor(minV/h)*h-h;size_t nu=size_t(std::ceil((maxU+h-lu)/h))+1,nv=size_t(std::ceil((maxV+h-lv)/h))+1;if(!nu||!nv||nu>4000001||nv>4000001||nu*nv>16000000)return SG_LIMIT_EXCEEDED;std::vector<double> depth(nu*nv,INFINITY);
  for(auto&p:pp){double pu=dot(p,u),pv=dot(p,v),pd=dot(p,d)-hd;long au=long(std::floor((pu-hu-lu)/h+1e-10)),bu=long(std::floor((pu+hu-lu)/h-1e-10)),av=long(std::floor((pv-hv-lv)/h+1e-10)),bv=long(std::floor((pv+hv-lv)/h-1e-10));for(long x=au;x<=bu;x++)for(long y=av;y<=bv;y++)if(x>=0&&y>=0&&size_t(x)<nu&&size_t(y)<nv)depth[size_t(x)*nv+size_t(y)]=std::min(depth[size_t(x)*nv+size_t(y)],pd);}
  if(count)*count={};for(size_t i=0;i<n;i++){base(i,target,holding,live,out,count);if(!stock[i]||!live[i]||target[i]||holding[i])continue;V p=point(*g,i);long x=long(std::floor((dot(p,u)-lu)/h)),y=long(std::floor((dot(p,v)-lv)/h));bool clear=x>=0&&y>=0&&size_t(x)<nu&&size_t(y)<nv&&dot(p,d)<depth[size_t(x)*nv+size_t(y)]-eps;double dep=dot(p,d)-entry;if(!clear){out[i]=SG_SHADOW;if(count)count->shadow_voxels++;}else if(dep<=reach+eps){out[i]=SG_REMOVE;if(count)count->remove_voxels++;}else{out[i]=SG_BEYOND_REACH;if(count)count->beyond_reach_voxels++;}}return SG_OK;
 }catch(const std::bad_alloc&){return SG_LIMIT_EXCEEDED;}catch(...){return SG_INTERNAL_ERROR;}}

int sg_turning_classify(const sg_grid*g,const sg_axis*a,const uint8_t*stock,const uint8_t*target,const uint8_t*holding,const uint8_t*live,int action,double reach,uint8_t*out,sg_counts*count){
 if(!valid(g,stock,target,holding,live,out)||!a||action<0||action>2||!(reach>0)||!std::isfinite(reach))return SG_INVALID_ARGUMENT;if((action==SG_TURN_FACE_POSITIVE&&a->held_side<0)||(action==SG_TURN_FACE_NEGATIVE&&a->held_side>0))return SG_INVALID_ARGUMENT;
 try{V axis=unit({a->direction[0],a->direction[1],a->direction[2]}),origin={a->origin_mm[0],a->origin_mm[1],a->origin_mm[2]};if(norm(axis)==0)return SG_INVALID_ARGUMENT;auto cs=corners(*g);double slo=INFINITY,shi=-INFINITY;for(auto&p:cs){double s=dot(sub(p,origin),axis);slo=std::min(slo,s);shi=std::max(shi,s);}double h=g->pitch_mm,hs=h*.5*(std::abs(axis[0])+std::abs(axis[1])+std::abs(axis[2])),lower=std::floor(slo/h)*h-h,upper=shi+h;size_t n=cell_count(*g);std::vector<std::pair<double,double>> pp;
  for(size_t i=0;i<n;i++)if(target[i]||(holding[i]&&stock[i])){V p=sub(point(*g,i),origin);double s=dot(p,axis),radius=0;for(int x=-1;x<=1;x+=2)for(int y=-1;y<=1;y+=2)for(int z=-1;z<=1;z+=2){V q={p[0]+x*h*.5,p[1]+y*h*.5,p[2]+z*h*.5};radius=std::max(radius,norm(sub(q,scale(axis,dot(q,axis)))));}pp.push_back({s,radius});lower=std::min(lower,std::floor((s-hs)/h)*h-h);upper=std::max(upper,s+hs+h);}if(pp.empty())return SG_INVALID_ARGUMENT;size_t np=size_t(std::ceil((upper-lower)/h))+1;if(np>8000000)return SG_LIMIT_EXCEEDED;std::vector<double> profile(np,-INFINITY);for(auto q:pp){long lo=long(std::floor((q.first-hs-lower)/h+1e-10)),hi=long(std::floor((q.first+hs-lower)/h-1e-10));for(long j=lo;j<=hi;j++)if(j>=0&&size_t(j)<np)profile[size_t(j)]=std::max(profile[size_t(j)],q.second);}
  if(count)*count={};for(size_t i=0;i<n;i++){base(i,target,holding,live,out,count);if(!stock[i]||!live[i]||target[i]||holding[i])continue;V p=sub(point(*g,i),origin);double s=dot(p,axis),r=norm(sub(p,scale(axis,s))),dep=0;bool clear=false;if(action==SG_TURN_OUTSIDE){long j=long(std::floor((s-lower)/h));clear=j>=0&&size_t(j)<np&&r>profile[size_t(j)]+eps;dep=a->original_stock_radius_mm-r;}else if(action==SG_TURN_FACE_POSITIVE){size_t j=0;double high=-INFINITY;while(j<np){high=std::max(high,profile[j]);if(high>=r-eps)break;j++;}clear=s<(j<np?lower+j*h:INFINITY)-eps;dep=s-slo;}else{size_t j=np;double high=-INFINITY;while(j>0){--j;high=std::max(high,profile[j]);if(high>=r-eps)break;}clear=s>(high>=r-eps?lower+(j+1)*h:-INFINITY)+eps;dep=shi-s;}if(!clear){out[i]=SG_SHADOW;if(count)count->shadow_voxels++;}else if(dep<=reach+eps){out[i]=SG_REMOVE;if(count)count->remove_voxels++;}else{out[i]=SG_BEYOND_REACH;if(count)count->beyond_reach_voxels++;}}return SG_OK;
 }catch(const std::bad_alloc&){return SG_LIMIT_EXCEEDED;}catch(...){return SG_INTERNAL_ERROR;}}

int sg_apply(uint8_t*live,const uint8_t*labels,size_t n){if(!live||!labels||!n||n>4000000)return SG_INVALID_ARGUMENT;for(size_t i=0;i<n;i++)if(labels[i]==SG_REMOVE)live[i]=0;return SG_OK;}
}
