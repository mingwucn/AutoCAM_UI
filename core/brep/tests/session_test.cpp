#include "session.hpp"
#include "setup.hpp"
#include "io.hpp"
#include <BRepPrimAPI_MakeBox.hxx>
#include <Standard_Failure.hxx>
#include <cmath>
#include <iostream>
#include <stdexcept>

void require(bool condition,const char* message) { if (!condition) throw std::runtime_error(message); }
template<class F> void rejects(F operation) {
  bool failed=false;
  try { operation(); } catch (...) { failed=true; }
  require(failed,"Expected rejection");
}
int main() {
  using namespace autocam::brep;
  try {
    auto target=BRepPrimAPI_MakeBox(6,6,6).Shape();
    auto prepared=prepare_stock(target,principal_axis(target,2),2,0,-1);
    Session session(target,prepared.stock,prepared.holding,prepared.setup);
    const double initial=volume(session.remaining());
    Action turn;turn.process=Process::turning;turn.reach_mm=20;
    auto p=session.preview(turn);
    require(volume(session.remaining())==initial,"Preview changed state");
    session.cancel_preview();
    rejects([&]{session.apply(p.token,p.revision);});
    p=session.preview(turn);session.apply(p.token,p.revision);
    require(session.revision()==1,"Commit revision did not advance");
    auto checkpoint=session.snapshot();
    auto encoded=encode_snapshot(checkpoint);
    auto restored=Session::restore(decode_snapshot(encoded));
    rejects([&]{decode_snapshot(encoded.substr(0,encoded.size()-10));});
    rejects([&]{decode_snapshot(encoded+"extra");});
    require(restored->revision()==1,"Restore lost revision");
    require(std::abs(volume(restored->remaining())-volume(session.remaining()))<1e-6,
            "Restore changed volume");
    Action mill;mill.direction=gp_Dir(1,0,0);mill.reach_mm=20;
    auto first=restored->preview(mill),second=restored->preview(mill);
    rejects([&]{restored->apply(first.token,first.revision);});
    restored->apply(second.token,second.revision);
    require(restored->revision()==2,"Mixed process commit did not advance");
    require(volume(restored->remaining())<volume(session.remaining()),"Milling removed no excess");
    auto invalid=mill;invalid.reach_mm=-1;
    const auto before=write_brep(restored->remaining());
    rejects([&]{restored->preview(invalid);});
    require(write_brep(restored->remaining())==before,"Failed preview mutated stock");
    auto reset_preview=restored->preview(mill);
    restored->reset();
    require(restored->revision()==3,"Reset must invalidate old revisions");
    rejects([&]{restored->apply(reset_preview.token,reset_preview.revision);});
    require(std::abs(volume(restored->remaining())-initial)<1e-6,"Reset did not recover original stock");
    auto forged=checkpoint;
    forged.remaining=write_brep(BRepPrimAPI_MakeBox(100,100,100).Shape());
    rejects([&]{Session::restore(forged);});
    forged=checkpoint;
    forged.remaining=write_brep(BRepPrimAPI_MakeBox(1,1,1).Shape());
    rejects([&]{Session::restore(forged);});
    std::cout << "Session cancellation, mixed processes, reset and snapshot recovery passed\n";
    return 0;
  } catch (const Standard_Failure& e) { std::cerr<<e.GetMessageString()<<'\n';return 1; }
    catch (const std::exception& e) { std::cerr<<e.what()<<'\n';return 1; }
}
