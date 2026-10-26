import { useState } from "react";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import { taskStatus } from "../../shared/utils/repair";
import { fmtDate } from "../../shared/utils/format";
import { Modal } from "../../shared/ui/Modal";
import { Button } from "../../shared/ui/Button";
import { Input, Textarea, FormGroup } from "../../shared/ui/Input";
import { PhotoGrid, InlinePhotoButton } from "../../shared/ui/PhotoUploader";
import { CreatorLine } from "../../shared/ui/CreatorLine";
import { RepairTaskWork, AddRepairTaskModal, intakeRepairEditor, Lightbox } from "../../shared/repair-work";
import {
  createIntakeRepair,
  createChamberIntake,
  updateIntakeVehicle,
  updateIntakeChamber,
  deleteIntakeRepair,
} from "../../shared/firebase/intake";
import { intakeKind, type IntakeRepair, type IntakeServiceType } from "../../shared/types/intake";

import {RequestWorkspace,RequestCard,RequestFilters,RequestStatusBar,RequestListState,useRequestOperation,OperationError} from "../../shared/requests/RequestWorkspace";
import {requestStage,requestAssignees,selectIntakeRequests,type RequestScope} from "../../shared/requests/workspaceLogic";

const SERVICE_TYPE_LABELS: Record<IntakeServiceType, string> = {
  refrigerator: "Рефрижератор",
  ac: "Кондиционер",
};

function num(v: string): number | undefined {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function chamberSummary(c?: { length?: number; width?: number; height?: number }): string {
  if (!c) return "";
  const { length: l, width: w, height: h } = c;
  if (l && w && h) return `${((l * w * h) / 1_000_000_000).toFixed(2)} м³ · ${l}×${w}×${h} мм`;
  if (l || w || h) return `${l ?? "?"}×${w ?? "?"}×${h ?? "?"} мм`;
  return "";
}

// ─── Photo picker (shared by both modals) ────────────────────────────────────

function PhotoField({ photo, onPick, onClear }: { photo: string; onPick: (url: string, path: string) => void; onClear: () => void }) {
  return (
    <FormGroup label="Фото">
      <div className="flex items-center gap-3">
        {photo && <img src={photo} alt="" style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover", border: "1px solid var(--border)" }} />}
        <InlinePhotoButton
          folder="intake"
          capture="environment"
          label={photo ? "Заменить фото" : "Сделать фото"}
          onUploaded={async (photos) => {
            const p = photos[0];
            if (p) onPick(p.url ?? "", p.path ?? "");
          }}
        />
        {photo && (
          <button type="button" onClick={onClear} style={{ fontSize: 12, color: "#dc2626", background: "transparent", border: "none", cursor: "pointer" }}>
            Убрать
          </button>
        )}
      </div>
    </FormGroup>
  );
}

// ─── Create / edit car modal ─────────────────────────────────────────────────

function IntakeVehicleModal({ intake, onClose }: { intake?: IntakeRepair; onClose: () => void }) {
  const { myProfile, user } = useAuth();
  const isEdit = !!intake;
  const v = intake?.vehicle;

  const [plate, setPlate] = useState(v?.plate ?? "");
  const [brand, setBrand] = useState(v?.brand ?? "");
  const [model, setModel] = useState(v?.model ?? "");
  const [serviceType, setServiceType] = useState<IntakeServiceType>(v?.serviceType ?? "refrigerator");
  const [photo, setPhoto] = useState(v?.photo ?? "");
  const [photoPath, setPhotoPath] = useState(v?.photoPath ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const editor = { uid: user?.uid ?? "", name: myProfile?.name ?? user?.email ?? "Неизвестно" };

  async function handleSave() {
    if(saving)return;
    if (!plate.trim()) { setError("Укажите гос. номер"); return; }
    setSaving(true);
    setError("");
    try {
      if (isEdit) {
        await updateIntakeVehicle(intake!.id, { plate, brand, model, photo, photoPath, serviceType }, editor);
      } else {
        await createIntakeRepair({
          plate,
          brand: brand || undefined,
          model: model || undefined,
          photo: photo || undefined,
          photoPath: photoPath || undefined,
          serviceType,
          creatorUid: editor.uid,
          creatorName: editor.name,
        });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? "Изменить автомобиль" : "Принять автомобиль"} onClose={onClose}>
      <FormGroup label="Гос. номер *">
        <Input aria-label="Госномер автомобиля" placeholder="А123ВС 125" value={plate} onChange={(e) => setPlate(e.target.value)} autoFocus />
      </FormGroup>
      <div className="flex gap-2">
        <FormGroup label="Марка"><Input aria-label="Марка автомобиля" placeholder="Hyundai" value={brand} onChange={(e) => setBrand(e.target.value)} /></FormGroup>
        <FormGroup label="Модель"><Input aria-label="Модель автомобиля" placeholder="Porter" value={model} onChange={(e) => setModel(e.target.value)} /></FormGroup>
      </div>
      <FormGroup label="Тип">
        <div className="flex gap-2">
          {(Object.keys(SERVICE_TYPE_LABELS) as IntakeServiceType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setServiceType(t)}
              style={{
                flex: 1, padding: "9px 12px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer",
                border: serviceType === t ? "1px solid var(--accent)" : "1px solid var(--border2)",
                background: serviceType === t ? "var(--accent)" : "var(--bg3)",
                color: serviceType === t ? "white" : "var(--text2)",
              }}
            >
              {SERVICE_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </FormGroup>
      <PhotoField photo={photo} onPick={(u, p) => { setPhoto(u); setPhotoPath(p); }} onClear={() => { setPhoto(""); setPhotoPath(""); }} />
      <OperationError error={error}/>
      <Button size="lg" onClick={() => void handleSave()} disabled={saving}>
        {saving ? "Сохранение..." : isEdit ? "Сохранить" : "Создать заявку"}
      </Button>
    </Modal>
  );
}

// ─── Create / edit chamber modal ─────────────────────────────────────────────

function IntakeChamberModal({ intake, onClose }: { intake?: IntakeRepair; onClose: () => void }) {
  const { myProfile, user } = useAuth();
  const isEdit = !!intake;
  const c = intake?.chamber;

  const [label, setLabel] = useState(c?.label ?? "");
  const [length, setLength] = useState(String(c?.length ?? ""));
  const [width, setWidth] = useState(String(c?.width ?? ""));
  const [height, setHeight] = useState(String(c?.height ?? ""));
  const [wall, setWall] = useState(String(c?.wallThickness ?? ""));
  const [notes, setNotes] = useState(c?.notes ?? "");
  const [photo, setPhoto] = useState(c?.photo ?? "");
  const [photoPath, setPhotoPath] = useState(c?.photoPath ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const editor = { uid: user?.uid ?? "", name: myProfile?.name ?? user?.email ?? "Неизвестно" };

  async function handleSave() {
    if(saving)return;
    if (!label.trim()) { setError("Укажите метку (магазин / адрес / описание)"); return; }
    setSaving(true);
    setError("");
    const dims = { length: num(length), width: num(width), height: num(height), wallThickness: num(wall) };
    try {
      if (isEdit) {
        await updateIntakeChamber(intake!.id, { label, ...dims, notes, photo, photoPath }, editor);
      } else {
        await createChamberIntake({
          label,
          ...dims,
          notes: notes || undefined,
          photo: photo || undefined,
          photoPath: photoPath || undefined,
          creatorUid: editor.uid,
          creatorName: editor.name,
        });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? "Изменить камеру" : "Принять камеру"} onClose={onClose}>
      <FormGroup label="Метка (магазин / адрес / описание) *">
        <Input aria-label="Метка камеры" placeholder="Магазин на Светланской, склад №2" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
      </FormGroup>
      <FormGroup label="Размеры (Д × Ш × В), мм">
        <div className="flex gap-2">
          <Input aria-label="Длина камеры, мм" type="number" min="1" placeholder="Длина" value={length} onChange={(e) => setLength(e.target.value)} />
          <Input aria-label="Ширина камеры, мм" type="number" min="1" placeholder="Ширина" value={width} onChange={(e) => setWidth(e.target.value)} />
          <Input aria-label="Высота камеры, мм" type="number" min="1" placeholder="Высота" value={height} onChange={(e) => setHeight(e.target.value)} />
        </div>
      </FormGroup>
      <FormGroup label="Толщина стенки, мм">
        <Input aria-label="Толщина стенки, мм" type="number" min="1" placeholder="80" value={wall} onChange={(e) => setWall(e.target.value)} />
      </FormGroup>
      <FormGroup label="Примечание">
        <Textarea aria-label="Примечание о камере" placeholder="Что с камерой, что нужно сделать..." value={notes} onChange={(e) => setNotes(e.target.value)} />
      </FormGroup>
      <PhotoField photo={photo} onPick={(u, p) => { setPhoto(u); setPhotoPath(p); }} onClear={() => { setPhoto(""); setPhotoPath(""); }} />
      <OperationError error={error}/>
      <Button size="lg" onClick={() => void handleSave()} disabled={saving}>
        {saving ? "Сохранение..." : isEdit ? "Сохранить" : "Создать заявку"}
      </Button>
    </Modal>
  );
}

// ─── Intake card ─────────────────────────────────────────────────────────────

function IntakeCard({intake}:{intake:IntakeRepair}){
 const {myProfile,user}=useAuth();const {staff}=useData();
 const [showAdd,setShowAdd]=useState(false),[showEdit,setShowEdit]=useState(false),[lightbox,setLightbox]=useState<string|null>(null);
 const operation=useRequestOperation();
 const editor=intakeRepairEditor(intake.id,{uid:user?.uid||"",name:myProfile?.name||user?.email||"Неизвестно"});
 const isChamber=intakeKind(intake)==="chamber",repair=intake.repair,tasks=repair.tasks??[],stage=requestStage(repair),archived=stage==="closed"||stage==="cancelled";
 const photo=isChamber?intake.chamber?.photo:intake.vehicle?.photo;
 const title=isChamber?intake.chamber?.label||"Холодильная камера":[intake.vehicle?.brand,intake.vehicle?.model].filter(Boolean).join(" ")||"Автомобиль";
 const names=requestAssignees(repair).map(id=>staff.find(s=>s.id===id)?.name||id).join(", ");
 async function handleDelete(){const what=isChamber?`камере «${intake.chamber?.label}»`:`автомобилю ${intake.vehicle?.plate}`;if(!confirm(`Удалить заявку по ${what}? Все задачи и фото будут удалены.`))return;await deleteIntakeRepair(intake);}
 return <RequestCard title={title} subtitle={isChamber?"Холодильная камера":[intake.vehicle?.plate,intake.vehicle?SERVICE_TYPE_LABELS[intake.vehicle.serviceType]:"Автомобиль"].filter(Boolean).join(" · ")} description={intake.chamber?.notes||repair.description} photo={photo} stage={stage} meta={[repair.date?`Приём: ${fmtDate(repair.date)}`:"Дата не указана",names||"Исполнитель не назначен",isChamber?chamberSummary(intake.chamber):""]} progress={{done:tasks.filter(t=>taskStatus(t)==="done").length,total:tasks.length}}>
  <CreatorLine name={intake.createdByName} date={intake.createdAt}/>
  <p className="request-work-note">{stage==="ready"?"Работы выполнены. Менеджер назначает клиента и подтверждает закрытие в «Отчётах».":"Клиент будет назначен менеджером при закрытии заявки в «Отчётах»."}</p>
  {(repair.description||intake.chamber?.notes)&&<p>{[repair.description,intake.chamber?.notes].filter(Boolean).join("\n")}</p>}
  {isChamber&&intake.chamber?.wallThickness&&<p>Толщина стенки: {intake.chamber.wallThickness} мм</p>}
  {archived?<div className="request-history">{tasks.map(task=><section key={task.id}><h3>{task.description}</h3><p>{taskStatus(task)==="done"?"Выполнено":"Не выполнено"}</p>{task.workComment&&<p>{task.workComment}</p>}<PhotoGrid photos={task.photos??[]} readOnly onView={setLightbox}/></section>)}</div>:<RepairTaskWork repair={repair} tasks={tasks} editor={editor} canManageTasks/>}
  <PhotoGrid photos={repair.photos??[]} readOnly onView={setLightbox}/>
  <OperationError error={operation.error}/>
  <div className="request-card-actions">
   {!archived&&<button type="button" className="is-primary" onClick={()=>setShowAdd(true)}>Добавить работу</button>}
   <button type="button" onClick={()=>setShowEdit(true)}>Изменить {isChamber?"камеру":"автомобиль"}</button>
   <button type="button" className="is-danger" disabled={operation.busy} onClick={()=>void operation.run(handleDelete)}>Удалить заявку</button>
  </div>
  {showAdd&&<AddRepairTaskModal editor={editor} repairFreonType={repair.freonType} onClose={()=>setShowAdd(false)}/>}
  {showEdit&&(isChamber?<IntakeChamberModal intake={intake} onClose={()=>setShowEdit(false)}/>:<IntakeVehicleModal intake={intake} onClose={()=>setShowEdit(false)}/>)}
  {lightbox&&<Lightbox url={lightbox} onClose={()=>setLightbox(null)}/>}
 </RequestCard>;
}

export function IntakeTab(){
 const {intakeRepairs,staff,sourceStatus}=useData();const {myProfile}=useAuth();
 const [newKind,setNewKind]=useState<null|"vehicle"|"chamber">(null);
 const [filters,setFilters]=useState({search:"",employee:"",mine:false,status:"open" as RequestScope["status"],sort:"newest" as RequestScope["sort"],kind:"all"});
 const ids=new Set(intakeRepairs.flatMap(item=>item.repair?requestAssignees(item.repair):[]));
 const options=[...staff,...[...ids].filter(id=>!staff.some(s=>s.id===id)).map(id=>({id,name:`Сотрудник ${id}`}))];
 const scope:RequestScope={...filters,uid:myProfile?.id||"",manager:["owner","admin","manager"].includes(myProfile?.role||""),staff:options};
 const patch=(value:Partial<RequestScope>)=>setFilters(current=>({...current,...value}));
 const reset=()=>setFilters({search:"",employee:"",mine:false,status:"open",sort:"newest",kind:"all"});
 const rows=selectIntakeRequests(intakeRepairs,scope),confirmed=sourceStatus.intakeRepairs==="ready";
 const count=(status:RequestScope["status"])=>confirmed?selectIntakeRequests(intakeRepairs,{...scope,status}).length:undefined;
 return <RequestWorkspace title="Приёмка" description="Автомобили и холодильные камеры до назначения клиента. Примите технику, добавьте работы и передайте результат менеджеру." actions={<><button type="button" className="btn-primary" onClick={()=>setNewKind("vehicle")}>Принять автомобиль</button><button type="button" className="btn-secondary" onClick={()=>setNewKind("chamber")}>Принять камеру</button></>}>
  <RequestFilters scope={scope} onChange={patch} onReset={reset} kinds={[{id:"all",label:"Все объекты"},{id:"vehicle",label:"Автомобили"},{id:"chamber",label:"Камеры"},{id:"ac",label:"Автокондиционеры"}]}/>
  <RequestStatusBar value={scope.status} items={[{id:"open",label:"Все открытые",count:count("open")},{id:"active",label:"В работе",count:count("active")},{id:"ready",label:"Ждут менеджера",count:count("ready")},{id:"archive",label:"Архив и отказы",count:count("archive")}]} onChange={status=>patch({status})}/>
  <div className="request-results-line"><strong>{confirmed?`Найдено: ${rows.length}`:"Данные не подтверждены"}</strong><p>Выполнение работ не закрывает заявку автоматически. Назначение клиента и закрытие остаются в «Отчётах».</p></div>
  <RequestListState statuses={[sourceStatus.intakeRepairs]} count={rows.length} filtered={!!(scope.search||scope.employee||scope.mine||scope.kind!=="all"||scope.status!=="open")} empty="В приёмке пока нет открытых заявок">
   {rows.map(item=><IntakeCard key={item.id} intake={item}/>)}
  </RequestListState>
  {newKind==="vehicle"&&<IntakeVehicleModal onClose={()=>setNewKind(null)}/>}
  {newKind==="chamber"&&<IntakeChamberModal onClose={()=>setNewKind(null)}/>}
 </RequestWorkspace>;
}
