#pragma once
#include <TopoDS_Face.hxx>
#include <gp_Dir.hxx>
#include <TopTools_ListOfShape.hxx>
namespace autocam::brep {
// Returns true only when all directional silhouettes for this surface family
// are handled analytically. Otherwise the caller uses the general HLR solver.
bool analytic_directional_contours(const TopoDS_Face&,const gp_Dir&,TopTools_ListOfShape&);
}
