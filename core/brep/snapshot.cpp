#include "session.hpp"
#include <iomanip>
#include <limits>
#include <locale>
#include <sstream>
#include <stdexcept>

namespace autocam::brep {
std::string encode_snapshot(const Snapshot& snapshot) {
  std::ostringstream out;out.imbue(std::locale::classic());
  out<<"shadow-brep-session-1\n"<<snapshot.engine<<'\n'<<std::setprecision(17);
  const auto p=snapshot.setup.axis.Location();const auto d=snapshot.setup.axis.Direction();
  out<<p.X()<<' '<<p.Y()<<' '<<p.Z()<<' '<<d.X()<<' '<<d.Y()<<' '<<d.Z()<<' '
     <<snapshot.setup.stock_radius_mm<<' '<<snapshot.setup.held_side<<' '
     <<snapshot.setup.volume_tolerance_mm3<<' '<<snapshot.revision<<'\n';
  for (const auto* shape : {&snapshot.target,&snapshot.stock,&snapshot.holding,&snapshot.remaining})
    out<<shape->size()<<'\n'<<*shape<<'\n';
  return out.str();
}
Snapshot decode_snapshot(const std::string& bytes) {
  constexpr std::size_t limit=256*1024*1024;
  if (bytes.empty() || bytes.size()>limit) throw std::invalid_argument("Snapshot size is invalid");
  std::istringstream in(bytes);in.imbue(std::locale::classic());
  std::string header,line;std::getline(in,header);
  if (header!="shadow-brep-session-1") throw std::invalid_argument("Unsupported session snapshot format");
  Snapshot result;std::getline(in,result.engine);std::getline(in,line);
  std::istringstream fields(line);fields.imbue(std::locale::classic());
  double x,y,z,dx,dy,dz;
  if (!(fields>>x>>y>>z>>dx>>dy>>dz>>result.setup.stock_radius_mm>>result.setup.held_side
              >>result.setup.volume_tolerance_mm3>>result.revision))
    throw std::invalid_argument("Invalid snapshot setup");
  fields>>std::ws;
  if (!fields.eof() || result.revision>=std::numeric_limits<std::uint32_t>::max())
    throw std::invalid_argument("Invalid snapshot revision or extra setup fields");
  result.setup.axis=gp_Ax1(gp_Pnt(x,y,z),gp_Dir(dx,dy,dz));
  for (auto* shape : {&result.target,&result.stock,&result.holding,&result.remaining}) {
    if (!std::getline(in,line) || line.empty() || line.find_first_not_of("0123456789")!=std::string::npos)
      throw std::invalid_argument("Invalid snapshot field length");
    std::size_t count=0;
    try { count=std::stoull(line); } catch (...) { throw std::invalid_argument("Snapshot field is too large"); }
    const auto offset=in.tellg();
    if (count>limit || offset<0 || count>bytes.size()-std::size_t(offset))
      throw std::invalid_argument("Truncated snapshot field");
    shape->resize(count);
    if (!in.read(shape->data(),count) || in.get()!='\n')
      throw std::invalid_argument("Truncated snapshot geometry");
  }
  if (in.peek()!=std::char_traits<char>::eof()) throw std::invalid_argument("Trailing snapshot data");
  return result;
}
}
