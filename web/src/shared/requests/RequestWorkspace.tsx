import {useState,type ReactNode} from 'react';
import type {SourceStatus} from '../context/dataReadiness';
import {Input,Select} from '../ui/Input';
import {requestStageLabel,type RequestScope,type RequestStage,type RequestStatus} from './workspaceLogic';
import './workspace.css';
export function RequestWorkspace({title,description,actions,children}:{title:string;description:string;actions?:ReactNode;children:ReactNode}){
 return <div className="request-workspace"><header className="request-heading"><div><h1>{title}</h1><p>{description}</p></div>{actions&&<div className="request-heading-actions">{actions}</div>}</header>{children}</div>;
}
export function RequestFilters({scope,onChange,onReset,kinds}:{scope:RequestScope;onChange(patch:Partial<RequestScope>):void;onReset():void;kinds?:Array<{id:string;label:string}>}){
 // Retain historical staff ids in the selector via the route-provided staff list.
 return <section className="request-toolbar" aria-label="Поиск и фильтры"><label className="request-search">Поиск<Input type="search" aria-label="Поиск заявок и работ" placeholder="Клиент, госномер, оборудование, работа…" value={scope.search} onChange={e=>onChange({search:e.target.value})}/></label><div className="request-toolbar-row"><label>Исполнитель<Select value={scope.employee} onChange={e=>onChange({employee:e.target.value})}><option value="">Все исполнители</option><option value="unassigned">Не назначен</option>{scope.staff.map(s=><option key={s.id} value={s.id}>{s.name||s.email||s.id}</option>)}</Select></label>{kinds&&<label>Оборудование<Select value={scope.kind} onChange={e=>onChange({kind:e.target.value})}>{kinds.map(k=><option key={k.id} value={k.id}>{k.label}</option>)}</Select></label>}<label>Порядок<Select value={scope.sort} onChange={e=>onChange({sort:e.target.value as RequestScope['sort']})}><option value="newest">Сначала новые</option><option value="oldest">Сначала старые</option></Select></label><label className="request-mine"><input type="checkbox" checked={scope.mine} onChange={e=>onChange({mine:e.target.checked})}/>Только мои</label><button type="button" className="request-text-button" onClick={onReset}>Сбросить</button></div></section>;
}
export function RequestStatusBar({value,items,onChange}:{value:RequestStatus;items:Array<{id:RequestStatus;label:string;count?:number}>;onChange(value:RequestStatus):void}){
 return <div className="request-status-bar" role="group" aria-label="Состояние заявок">{items.map(item=><button type="button" key={item.id} aria-pressed={value===item.id} onClick={()=>onChange(item.id)}>{item.label}{item.count!==undefined&&<span>{item.count}</span>}</button>)}</div>;
}
export function RequestListState({statuses,count,filtered,empty,children}:{statuses:SourceStatus[];count:number;filtered:boolean;empty:string;children?:ReactNode}){
 if(statuses.includes('error'))return <div className="request-feedback is-error" role="alert"><strong>Данные недоступны</strong><p>Не удалось загрузить этот список. Обновите страницу, чтобы повторить подключение. Отсутствие данных не означает, что заявок нет.</p></div>;
 if(statuses.some(s=>s!=='ready'))return <div className="request-feedback" role="status">Загружаем заявки и работы…</div>;
 if(!count)return <div className="request-feedback"><strong>{filtered?'По выбранным условиям ничего не найдено':empty}</strong><p>{filtered?'Измените поиск или сбросьте фильтры.':'Новые записи появятся здесь после создания.'}</p></div>;
 return <div className="request-list">{children}</div>;
}
export function RequestCard({title,subtitle,description,meta,stage,progress,photo,children}:{title:string;subtitle?:string;description?:string;meta:string[];stage:RequestStage;progress?:{done:number;total:number};photo?:string;children:ReactNode}){
 return <article className="request-card"><details><summary><div className="request-card-summary">{photo?<img src={photo} alt="" loading="lazy" className="request-thumbnail"/>:<span aria-hidden="true" className="request-thumbnail is-placeholder"><svg viewBox="0 0 24 24" fill="none"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></span>}<div className="request-card-main"><div className="request-card-title"><h2>{title}</h2><span className={`request-badge is-${stage}`}>{requestStageLabel(stage)}</span></div>{subtitle&&<p className="request-card-subtitle">{subtitle}</p>}{description&&<p className="request-card-description">{description}</p>}<div className="request-card-meta">{meta.filter(Boolean).map((line,i)=><span key={i}>{line}</span>)}</div>{progress&&progress.total>0&&<div className="request-progress"><progress value={progress.done} max={progress.total} aria-label="Выполненные работы"/><span>{progress.done} из {progress.total} работ</span></div>}</div><span className="request-expand" aria-hidden="true">⌄</span></div><span className="request-disclosure-label">Работы и подробности</span></summary><div className="request-card-details">{children}</div></details></article>;
}
export function useRequestOperation(){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 // Event dispatch flushes disabled state before the next click.
 async function run(operation:()=>Promise<unknown>){if(busy)return;setBusy(true);setError('');try{await operation();}catch(e){setError(e instanceof Error?e.message:'Не удалось выполнить действие. Попробуйте ещё раз.');}finally{setBusy(false);}}
 return {busy,error,run};
}
export function OperationError({error}:{error:string}){return error?<p className="request-operation-error" role="alert">{error}</p>:null;}
