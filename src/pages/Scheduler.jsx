import { useState, useMemo, useEffect } from 'react';
import { ChevronLeft, ChevronRight, User, X, Clock, MapPin, Briefcase, FileText, Printer, Eye, Edit3, Trash2, Loader2, AlertCircle, Upload, Plus, Info, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { createAllocation, JOB_STATUSES, JOB_TYPES, PRIORITIES, createJob } from '../data/models';
import { getWeekDates, getMonthDates, formatDate, formatDateShort, formatDay, formatMonthYear, getTodayStr, statusToKey, jobTypeToKey, getPriorityColor, getRoleColor, compressImage } from '../utils/helpers';
import { addDays, addMonths, startOfMonth, parseISO } from 'date-fns';
import './Scheduler.css';

export default function Scheduler({ user }) {
    const today = getTodayStr();
    const [viewMode, setViewMode] = useState('week'); // 'week' | 'month'
    const [weekOffset, setWeekOffset] = useState(0);
    const [monthOffset, setMonthOffset] = useState(0);
    const [jobs, setJobs] = useState([]);
    const [allocations, setAllocations] = useState([]);
    const [staff, setStaff] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedJob, setSelectedJob] = useState(null);
    const [showJobModal, setShowJobModal] = useState(false);
    const [editingJob, setEditingJob] = useState(null);

    useEffect(() => {
        fetchData();
    }, []);

    // Sync selectedJob when jobs array updates
    useEffect(() => {
        if (selectedJob) {
            const freshJob = jobs.find(j => j.id === selectedJob.id);
            if (freshJob) {
                setSelectedJob(freshJob);
            }
        }
    }, [jobs]);

    const fetchData = async (isSilent = false) => {
        if (!isSilent) setLoading(true);
        try {
            const { data: sData } = await supabase.from('staff').select('*').order('nickname');
            setStaff(sData || []);

            const { data: aData } = await supabase.from('allocations').select('*');
            setAllocations(aData || []);

            const { data: jData } = await supabase.from('jobs').select(`
                *, sub_tasks (*), attachments (*), progress_logs (*, log_staff_assignments(staff_id))
            `).order('created_at', { ascending: false });

            if (jData) {
                const formatted = jData.map(j => {
                    const jobAllocs = (aData || []).filter(a => a.job_id === j.id);
                    return {
                        id: j.id, qtNumber: j.qt_number, projectName: j.project_name, clientName: j.client_name,
                        jobType: j.job_type, status: j.status, startDate: j.start_date, endDate: j.end_date,
                        priority: j.priority, notes: j.notes, createdBy: j.created_by, overallProgress: j.overall_progress,
                        currentIssues: j.current_issues, defaultCheckIn: j.default_check_in, defaultCheckOut: j.default_check_out,
                        subTasks: (j.sub_tasks || []).map(st => ({ id: st.id, title: st.title, isCompleted: st.is_completed })),
                        attachments: (j.attachments || []).map(at => ({ id: at.id, name: at.name, url: at.url, type: at.type })),
                        progressLogs: (j.progress_logs || []).map(pl => ({
                            id: pl.id, date: pl.log_date, text: pl.text, author: pl.author, workerIds: (pl.log_staff_assignments || []).map(lsa => lsa.staff_id)
                        })).sort((a, b) => new Date(b.date) - new Date(a.date) || b.id - a.id),
                        assignedStaffIds: [...new Set(jobAllocs.map(a => a.staff_id))]
                    };
                });
                setJobs(formatted);
            }
        } catch (err) { console.error(err); }
        finally { if (!isSilent) setLoading(false); }
    };

    const handleSaveJob = async (job) => {
        try {
            const dbData = {
                qt_number: job.qtNumber, project_name: job.projectName, client_name: job.clientName, job_type: job.jobType, status: job.status,
                start_date: job.startDate, end_date: job.endDate, default_check_in: job.defaultCheckIn, default_check_out: job.defaultCheckOut,
                priority: job.priority, notes: job.notes, created_by: job.createdBy, overall_progress: job.overallProgress, current_issues: job.currentIssues, updated_at: new Date().toISOString()
            };
            let jobId = job.id;
            if (job.id) await supabase.from('jobs').update(dbData).eq('id', job.id);
            else { const { data } = await supabase.from('jobs').insert([dbData]).select(); jobId = data[0].id; }
            
            await supabase.from('sub_tasks').delete().eq('job_id', jobId);
            if (job.subTasks?.length > 0) await supabase.from('sub_tasks').insert(job.subTasks.map(st => ({ job_id: jobId, title: st.title, is_completed: st.isCompleted })));
            
            if (job.assignedStaffIds?.length > 0) {
                const { data: existing } = await supabase.from('allocations').select('staff_id').eq('job_id', jobId).eq('date', job.startDate);
                const existingIds = (existing || []).map(e => e.staff_id);
                const newToAlloc = job.assignedStaffIds.filter(sid => !existingIds.includes(sid));
                if (newToAlloc.length > 0) await supabase.from('allocations').insert(newToAlloc.map(sid => ({ job_id: jobId, staff_id: sid, date: job.startDate, status: 'ได้รับมอบหมาย' })));
            }
            await fetchData(); setShowJobModal(false); setEditingJob(null);
        } catch (err) { alert('Save Failed'); }
    };

    const handleDeleteJob = async (id) => { if (confirm('Delete this job?')) { await supabase.from('jobs').delete().eq('id', id); await fetchData(); setSelectedJob(null); } };

    const weekDates = useMemo(() => getWeekDates(addDays(new Date(), weekOffset * 7)), [weekOffset]);
    const monthDates = useMemo(() => getMonthDates(addMonths(new Date(), monthOffset)), [monthOffset]);
    const currentRangeDates = viewMode === 'week' ? weekDates : monthDates;

    const uniqueClients = useMemo(() => {
        const clients = jobs.map(j => j.clientName).filter(Boolean);
        return [...new Set(clients)].sort((a, b) => a.localeCompare(b, 'th'));
    }, [jobs]);

    if (loading && jobs.length === 0) return <div className="loading-container"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="page-content scheduler-page">
            <div className="page-header">
                <div><h1>ตารางงาน</h1><p className="subtitle">มอบหมายงานและติดตามความคืบหน้า</p></div>
                <div className="header-actions">
                    <div className="view-mode-selector">
                        <button className={`view-btn ${viewMode === 'week' ? 'active' : ''}`} onClick={() => setViewMode('week')}>สัปดาห์</button>
                        <button className={`view-btn ${viewMode === 'month' ? 'active' : ''}`} onClick={() => setViewMode('month')}>เดือน</button>
                    </div>
                    <button className="btn btn-primary" onClick={() => { setEditingJob(null); setShowJobModal(true); }}><Plus size={16} /> เพิ่มงานใหม่</button>
                </div>
            </div>

            <div className="scheduler-container">
                <div className="scheduler-header">
                    <div className="current-range">
                        <button className="btn btn-ghost btn-icon" onClick={() => viewMode === 'week' ? setWeekOffset(prev => prev - 1) : setMonthOffset(prev => prev - 1)}><ChevronLeft size={20} /></button>
                        <h2>{viewMode === 'week' ? `สัปดาห์ที่ ${weekOffset >= 0 ? '+' : ''}${weekOffset}` : formatMonthYear(currentRangeDates[10])}</h2>
                        <button className="btn btn-ghost btn-icon" onClick={() => viewMode === 'week' ? setWeekOffset(prev => prev + 1) : setMonthOffset(prev => prev + 1)}><ChevronRight size={20} /></button>
                        <button className="btn btn-secondary btn-sm" onClick={() => { setWeekOffset(0); setMonthOffset(0); }}>วันนี้</button>
                    </div>
                </div>

                <div className="scheduler-grid">
                    {currentRangeDates.map(dateStr => {
                        const isToday = dateStr === today;
                        const dayAllocs = allocations.filter(a => a.date === dateStr);
                        const uniqueJobIdsForDay = [...new Set(dayAllocs.map(a => a.job_id))];
                        
                        return (
                            <div key={dateStr} className={`scheduler-day ${isToday ? 'today' : ''}`}>
                                <div className="day-header">
                                    <span className="day-name">{formatDay(dateStr)}</span>
                                    <div className="day-date">{parseISO(dateStr).getDate()}{isToday && <span className="today-badge">วันนี้</span>}</div>
                                </div>
                                <div className="day-content">
                                    {uniqueJobIdsForDay.length > 0 ? (
                                        uniqueJobIdsForDay.map(jobId => {
                                            const job = jobs.find(j => j.id === jobId);
                                            if (!job) return null;
                                            const jobWorkers = dayAllocs.filter(a => a.job_id === jobId).map(a => staff.find(s => s.id === a.staff_id)).filter(Boolean);
                                            return (
                                                <div key={jobId} className={`scheduler-job-card status-${statusToKey(job.status)}`} onClick={() => setSelectedJob(job)}>
                                                    <div className="sj-header"><span className="sj-name">{job.projectName}</span></div>
                                                    <div className="sj-meta"><span className="sj-type">{job.jobType}</span><span className="sj-time-range">{job.defaultCheckIn}-{job.defaultCheckOut}</span></div>
                                                    <div className="sj-staff">{jobWorkers.map(w => (<span key={w.id} className="sj-staff-chip">{w.nickname}</span>))}</div>
                                                </div>
                                            );
                                        })
                                    ) : (<div className="day-empty">ไม่มีงาน</div>)}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {selectedJob && <JobDetailModal job={selectedJob} staff={staff} user={user} onClose={() => setSelectedJob(null)} onEdit={() => { setEditingJob(selectedJob); setShowJobModal(true); }} onUpdate={() => fetchData(true)} />}
            {(showJobModal || editingJob) && <JobModal job={editingJob} staff={staff} clientSuggestions={uniqueClients} onSave={handleSaveJob} onClose={() => { setShowJobModal(false); setEditingJob(null); }} />}
        </div>
    );
}

function JobModal({ job, staff, clientSuggestions = [], onSave, onClose }) {
    const [form, setForm] = useState(job ? { ...job, assignedStaffIds: job.assignedStaffIds || [] } : createJob());
    const [selectionType, setSelectionType] = useState(['พี่ยุ้ย', 'แพร', 'ไอซ์'].includes(form.createdBy) ? form.createdBy : (form.createdBy ? 'อื่นๆ' : ''));
    const [subTaskInput, setSubTaskInput] = useState('');
    const update = (f, v) => setForm(prev => ({ ...prev, [f]: v }));

    const handleAddSubTask = () => {
        if (!subTaskInput.trim()) return;
        const newSubTask = { id: Date.now(), title: subTaskInput.trim(), isCompleted: false };
        const ut = [...(form.subTasks || []), newSubTask];
        update('subTasks', ut); setSubTaskInput('');
        update('overallProgress', ut.length > 0 ? Math.round((ut.filter(t => t.isCompleted).length / ut.length) * 100) : 0);
    };

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal" style={{ maxWidth: '750px' }}>
                <div className="modal-header"><h2>{job ? 'แก้ไขงาน' : 'เพิ่มงานใหม่'}</h2><button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button></div>
                <div className="modal-body"><div className="form-grid">
                    <div className="input-group"><label>เลขที่ QT</label><input className="input" value={form.qtNumber} onChange={e => update('qtNumber', e.target.value)} /></div>
                    <div className="input-group"><label>ชื่อโปรเจกต์</label><input className="input" value={form.projectName} onChange={e => update('projectName', e.target.value)} /></div>
                    <div className="input-group"><label>ชื่อลูกค้า</label><input className="input" value={form.clientName} onChange={e => update('clientName', e.target.value)} list="client-list" /><datalist id="client-list">{clientSuggestions.map(c => <option key={c} value={c} />)}</datalist></div>
                    <div className="input-group">
                        <label>เซลล์ที่รับผิดชอบ</label>
                        <select className="select" value={selectionType} onChange={e => { setSelectionType(e.target.value); if (e.target.value !== 'อื่นๆ') update('createdBy', e.target.value); }}>
                            <option value="">เลือกผู้ลงชื่อ</option><option value="พี่ยุ้ย">พี่ยุ้ย</option><option value="แพร">แพร</option><option value="ไอซ์">ไอซ์</option><option value="อื่นๆ">อื่นๆ</option>
                        </select>
                        {selectionType === 'อื่นๆ' && <input className="input" style={{ marginTop: '8px' }} value={form.createdBy} onChange={e => update('createdBy', e.target.value)} />}
                    </div>
                    <div className="input-group"><label>ประเภทงาน</label><select className="select" value={form.jobType} onChange={e => update('jobType', e.target.value)}>{JOB_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                    <div className="input-group"><label>สถานะ</label><select className="select" value={form.status} onChange={e => update('status', e.target.value)}>{JOB_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
                    <div className="form-row">
                        <div className="input-group"><label>วันที่เริ่ม</label><input className="input" type="date" value={form.startDate} onChange={e => update('startDate', e.target.value)} /></div>
                        <div className="input-group"><label>วันที่สิ้นสุด</label><input className="input" type="date" value={form.endDate} onChange={e => update('endDate', e.target.value)} /></div>
                    </div>
                    <div className="form-row">
                        <div className="input-group"><label>เวลาเข้างาน</label><input className="input" type="time" value={form.defaultCheckIn} onChange={e => update('defaultCheckIn', e.target.value)} /></div>
                        <div className="input-group"><label>เวลาเลิกงาน</label><input className="input" type="time" value={form.defaultCheckOut} onChange={e => update('defaultCheckOut', e.target.value)} /></div>
                    </div>
                    <div className="input-group full-width" style={{ borderTop: '1px solid var(--border-primary)', paddingTop: '16px' }}>
                        <label>รายการงานย่อย</label>
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}><input className="input" placeholder="เพิ่ม..." value={subTaskInput} onChange={e => setSubTaskInput(e.target.value)} /><button className="btn btn-secondary" onClick={handleAddSubTask}>+ เพิ่ม</button></div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>{(form.subTasks || []).map(t => (<div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px', background: 'var(--bg-tertiary)', borderRadius: '4px' }}><input type="checkbox" checked={t.isCompleted} onChange={e => { const ut = form.subTasks.map(st => st.id === t.id ? {...st, isCompleted: e.target.checked} : st); update('subTasks', ut); update('overallProgress', Math.round((ut.filter(x => x.isCompleted).length / ut.length) * 100)); }} /><span>{t.title}</span><button onClick={() => update('subTasks', form.subTasks.filter(st => st.id !== t.id))} style={{ color: '#ef4444', border: 'none', background: 'none' }}>×</button></div>))}</div>
                    </div>
                    <div className="input-group full-width" style={{ borderTop: '1px solid var(--border-primary)', paddingTop: '16px' }}>
                        <label>ทีมงานประจำโปรเจกต์</label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>{staff.map(s => (<button key={s.id} type="button" onClick={() => update('assignedStaffIds', (form.assignedStaffIds || []).includes(s.id) ? form.assignedStaffIds.filter(id => id !== s.id) : [...(form.assignedStaffIds || []), s.id])} className={`staff-toggle-btn ${(form.assignedStaffIds || []).includes(s.id) ? 'active' : ''}`} style={{ padding: '4px 12px', borderRadius: '20px', border: '1px solid', borderColor: (form.assignedStaffIds || []).includes(s.id) ? 'var(--brand-primary)' : 'var(--border-primary)', background: (form.assignedStaffIds || []).includes(s.id) ? 'var(--brand-primary)' : 'transparent', color: (form.assignedStaffIds || []).includes(s.id) ? '#fff' : 'inherit', fontSize: '12px' }}>{s.nickname}</button>))}</div>
                    </div>
                    <div className="input-group full-width"><label>หมายเหตุ</label><textarea className="textarea" value={form.notes} onChange={e => update('notes', e.target.value)} /></div>
                </div></div>
                <div className="modal-footer"><button className="btn btn-secondary" onClick={onClose}>ยกเลิก</button><button className="btn btn-primary" onClick={() => onSave(form)}>บันทึก</button></div>
            </div>
        </div>
    );
}

function JobDetailModal({ job, staff, user, onClose, onEdit, onUpdate }) {
    const [newLog, setNewLog] = useState('');
    const [logStaffIds, setLogStaffIds] = useState([]);
    const [localIssues, setLocalIssues] = useState(job.currentIssues || '');
    useEffect(() => { setLocalIssues(job.currentIssues || ''); }, [job.id, job.currentIssues]);

    const handleAddLog = async () => {
        if (!newLog.trim()) return;
        const author = user?.user_metadata?.nickname || user?.email?.split('@')[0] || 'Admin';
        const { data } = await supabase.from('progress_logs').insert([{ job_id: job.id, log_date: new Date().toISOString().split('T')[0], text: newLog, author }]).select();
        if (logStaffIds.length > 0) await supabase.from('log_staff_assignments').insert(logStaffIds.map(sid => ({ log_id: data[0].id, staff_id: sid })));
        setNewLog(''); setLogStaffIds([]); onUpdate();
    };

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal" style={{ maxWidth: '700px' }}>
                <div className="modal-header"><div><h2>{job.projectName}</h2><span className="subtitle">{job.qtNumber} • {job.clientName}</span></div><div style={{ display: 'flex', gap: '8px' }}><button className="btn btn-ghost btn-icon" onClick={onEdit}><Edit3 size={18} /></button><button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button></div></div>
                <div className="modal-body">
                    <div className="detail-row"><span className={`badge badge-${statusToKey(job.status)}`}>{job.status}</span><span className="job-type-tag">{job.jobType}</span></div>
                    <div className="detail-section" style={{ background: 'var(--bg-tertiary)', padding: '16px', borderRadius: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}><h4 style={{ margin: 0 }}>ความคืบหน้า: {job.overallProgress}%</h4></div>
                        {(job.subTasks || []).length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                                {job.subTasks.map(t => (
                                    <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #e5e7eb', cursor: 'pointer' }}>
                                        <input type="checkbox" checked={t.isCompleted} onChange={async (e) => {
                                            const ut = job.subTasks.map(st => st.id === t.id ? {...st, isCompleted: e.target.checked} : st);
                                            const prog = Math.round((ut.filter(x => x.isCompleted).length / ut.length) * 100);
                                            await supabase.from('jobs').update({ overall_progress: prog, status: prog === 100 ? 'เสร็จสมบูรณ์' : job.status }).eq('id', job.id);
                                            await supabase.from('sub_tasks').delete().eq('job_id', job.id);
                                            await supabase.from('sub_tasks').insert(ut.map(x => ({ job_id: job.id, title: x.title, is_completed: x.isCompleted })));
                                            onUpdate();
                                        }} />
                                        <span style={{ fontSize: '14px', textDecoration: t.isCompleted ? 'line-through' : 'none', color: t.isCompleted ? '#9ca3af' : 'inherit' }}>{t.title}</span>
                                    </label>
                                ))}
                            </div>
                        )}
                        <div style={{ display: 'flex', gap: '8px' }}><input className="input" placeholder="ปัญหาที่พบ..." value={localIssues} onChange={e => setLocalIssues(e.target.value)} style={{ flex: 1 }} /><button className="btn btn-secondary btn-sm" onClick={async () => { await supabase.from('jobs').update({ current_issues: localIssues }).eq('id', job.id); onUpdate(); }}>อัปเดตปัญหา</button></div>
                    </div>
                    <div className="detail-section">
                        <h4>บันทึกความคืบหน้า (โดย: {user?.user_metadata?.nickname || user?.email?.split('@')[0]})</h4>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>{staff.map(s => (<button key={s.id} onClick={() => setLogStaffIds(prev => prev.includes(s.id) ? prev.filter(id => id !== s.id) : [...prev, s.id])} style={{ border: 'none', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', background: logStaffIds.includes(s.id) ? 'var(--brand-primary)' : 'var(--bg-tertiary)', color: logStaffIds.includes(s.id) ? '#fff' : 'inherit' }}>{s.nickname}</button>))}</div>
                        <div style={{ display: 'flex', gap: '8px' }}><textarea className="input" placeholder="พิมพ์บันทึก..." value={newLog} onChange={e => setNewLog(e.target.value)} style={{ flex: 1, minHeight: '60px' }} /><button className="btn btn-primary" onClick={handleAddLog}>บันทึก</button></div>
                        <div className="log-list" style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto' }}>{(job.progressLogs || []).map(log => (<div key={log.id} style={{ padding: '10px', background: '#fff', borderRadius: '6px', border: '1px solid var(--border-primary)' }}><div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '11px', color: 'var(--text-tertiary)' }}><span>{formatDate(log.date)} • โดย: {log.author}</span></div><p style={{ margin: 0, fontSize: '13px' }}>{log.text}</p></div>))}</div>
                    </div>
                </div>
            </div>
        </div>
    );
}
