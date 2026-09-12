#pragma once
#include <TopoDS_Shape.hxx>
#include <string>

namespace autocam::brep {
TopoDS_Shape read_step(const std::string& bytes);
std::string write_brep(const TopoDS_Shape& shape);
TopoDS_Shape read_brep(const std::string& bytes);
}
