#include "io.hpp"
#include "material.hpp"
#include <STEPControl_Reader.hxx>
#include <BRepTools.hxx>
#include <BRep_Builder.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <sstream>
#include <stdexcept>

namespace autocam::brep {
namespace {
void require_solids(const TopoDS_Shape& shape) {
  if (volume(shape) <= 0) throw std::runtime_error("Import contains no positive-volume solid");
  TopTools_IndexedMapOfShape members;
  int solids=0;
  for (TopExp_Explorer it(shape,TopAbs_SOLID); it.More(); it.Next()) {
    TopExp::MapShapes(it.Current(),members);
    ++solids;
  }
  if (!solids) throw std::runtime_error("Import contains surfaces but no solids");
  for (auto type : {TopAbs_FACE,TopAbs_EDGE,TopAbs_VERTEX})
    for (TopExp_Explorer it(shape,type); it.More(); it.Next())
      if (!members.Contains(it.Current()))
        throw std::runtime_error("Import mixes solids with unattached surface or wire geometry");
}
}
TopoDS_Shape read_step(const std::string& bytes) {
  if (bytes.empty() || bytes.size()>100*1024*1024)
    throw std::invalid_argument("STEP input must contain 1 byte to 100 MiB");
  std::istringstream stream(bytes);
  STEPControl_Reader reader;
  if (reader.ReadStream("local.step",stream) != IFSelect_RetDone)
    throw std::runtime_error("OpenCascade could not read the STEP input");
  reader.SetSystemLengthUnit(1.0); // Millimetres in both native and WASM builds.
  if (reader.TransferRoots() <= 0) throw std::runtime_error("STEP input contains no transferable roots");
  auto shape=reader.OneShape();
  require_solids(shape);
  return shape;
}
std::string write_brep(const TopoDS_Shape& shape) {
  volume(shape);
  std::ostringstream stream;
  BRepTools::Write(shape,stream,false,false,TopTools_FormatVersion_VERSION_3);
  if (!stream.good()) throw std::runtime_error("B-Rep snapshot serialization failed");
  return stream.str();
}
TopoDS_Shape read_brep(const std::string& bytes) {
  if (bytes.empty() || bytes.size()>256*1024*1024)
    throw std::invalid_argument("B-Rep snapshot must contain 1 byte to 256 MiB");
  std::istringstream stream(bytes);
  BRep_Builder builder;
  TopoDS_Shape shape;
  BRepTools::Read(shape,stream,builder);
  volume(shape);
  return shape;
}
}
