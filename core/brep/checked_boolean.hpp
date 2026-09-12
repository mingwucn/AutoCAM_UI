#pragma once
#include "material.hpp"
#include <BRepBuilderAPI_Copy.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS_Iterator.hxx>
#include <TopTools_ListOfShape.hxx>
#include <Standard_Failure.hxx>
#include <sstream>
#include <stdexcept>

namespace autocam::brep {
// Port the existing Python CheckedBRepBoolean operand boundary: an OCCT
// material operand consists of solid leaves, or a valid empty compound.
// A nonempty compound passed as one operand can give a false empty Common.
inline bool solid_only_topology(const TopoDS_Shape& shape) {
  if(shape.IsNull())return false;
  if(shape.ShapeType()==TopAbs_SOLID)return true;
  if(shape.ShapeType()!=TopAbs_COMPOUND && shape.ShapeType()!=TopAbs_COMPSOLID)return false;
  for(TopoDS_Iterator child(shape);child.More();child.Next())
    if(!solid_only_topology(child.Value()))return false;
  return true;
}
inline bool valid_boolean_material(const TopoDS_Shape& shape) {
  try {
    if(!solid_only_topology(shape)||!BRepCheck_Analyzer(shape).IsValid())return false;
    for(TopExp_Explorer solids(shape,TopAbs_SOLID);solids.More();solids.Next())
      if(volume(solids.Current())<=0)return false;
    return true;
  } catch(const std::runtime_error&) {
    // Invalid/negative mass is an invalid-result classification too. Let the
    // caller perform its one independent-copy retry instead of bypassing it.
    return false;
  } catch(const Standard_Failure&) {return false;}
}
inline void append_boolean_solids(TopTools_ListOfShape& list,const TopoDS_Shape& shape) {
  TopExp_Explorer solids(shape,TopAbs_SOLID);
  if(!solids.More()){list.Append(shape);return;}
  for(;solids.More();solids.Next())list.Append(solids.Current());
}
template<class Operation> TopoDS_Shape checked_boolean(const TopoDS_Shape& a,const TopoDS_Shape& b) {
  if(!valid_boolean_material(a)||!valid_boolean_material(b))
    throw std::runtime_error("Boolean operand is not valid solid material");
  for(int attempt=0;attempt<2;++attempt) {
    // Only an invalid result permits one destructive retry. It owns independent
    // geometry copies, so no retry can alter the target or committed stock.
    const auto left=attempt?BRepBuilderAPI_Copy(a,true,false).Shape():a;
    const auto right=attempt?BRepBuilderAPI_Copy(b,true,false).Shape():b;
    TopTools_ListOfShape args,tools;append_boolean_solids(args,left);append_boolean_solids(tools,right);
    Operation operation;operation.SetArguments(args);operation.SetTools(tools);
    operation.SetRunParallel(false);operation.SetNonDestructive(attempt==0);operation.Build();
    if(!operation.IsDone()||operation.HasErrors()) {
      std::ostringstream message;message<<"B-Rep Boolean failed: ";
      operation.DumpErrors(message);operation.DumpWarnings(message);
      throw std::runtime_error(message.str());
    }
    const auto result=operation.Shape();
    if(valid_boolean_material(result))return result;
  }
  throw std::runtime_error("B-Rep Boolean produced invalid material on both attempts");
}
}
