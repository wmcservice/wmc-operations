import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, User, X, Clock, MapPin, Briefcase, FileText, Printer, Eye, Edit3, Trash2, Loader2, AlertCircle, Upload, Plus } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { getJobs, saveJob, getStaff, getAllocations, saveAllocation, deleteAllocation, getAllocationsByJob, deleteJob } from '../data/store';
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
    const [selectedStaffId, setSelectedStaffId] = useState(null);
    const [showReportModal, setShowReportModal] = useState(false);
    const [reportDate, setReportDate] = useState(null);
    const [selectedJob, setSelectedJob] = useState(null);
    const [showEditJobModal, setShowEditJobModal] = useState(false);
    const [editingJob, setEditingJob] = useState(null);
    const [showJobModal, setShowJobModal] = useState(false);

    useEffect(() => {
        fetchData();
    }, []);

    // Sync selectedJob when jobs array updates
    useEffect(() => {
        if (selectedJob) {
            const freshJob = jobs.find(j => j.id === selectedJob.id);
            if (freshJob) {
                if (freshJob.updatedAt !== selectedJob.updatedAt || 
                    freshJob.overallProgress !== selectedJob.overallProgress ||
                    freshJob.assignedStaffIds?.length !== selectedJob.assignedStaffIds?.length) {
                    setSelectedJob(freshJob);
                }
            }
        }
    }, [jobs, selectedJob]);

    const fetchData = async (isSilent = false) => {
        if (!isSilent) setLoading(true);
        try {
            const { data: sData } = await supabase.from('staff').select('*').order('nickname');
            const formattedStaff = (sData || []).map(s => ({
                id: s.id, nickname: s.nickname || 'ช่าง', fullName: s.full_name || '', role: s.role || 'พนักงาน', isActive: s.is_active ?? true
            }));
            setStaff(formattedStaff);

            const { data: aData } = await supabase.from('allocations').select('*');
            const allAllocations = aData || [];
            setAllocations(allAllocations);

            const { data: jData } = await supabase.from('jobs').select(`
                *, sub_tasks (*), attachments (*), progress_logs (*, log_staff_assignments(staff_id))
            `).order('created_at', { ascending: false });

            if (jData) {
                const formattedJobs = jData.map(j => {
                    const jobAllocs = allAllocations.filter(a => a.job_id === j.id);
                    const uniqueStaffIds = [...new Set(jobAllocs.map(a => a.staff_id))];
                    return {
                        id: j.id, qtNumber: j.qt_number || '', projectName: j.project_name || 'Untitled', clientName: j.client_name || '',
                        jobType: j.job_type || 'อื่นๆ', status: j.status || 'รอคิว', startDate: j.start_date || today, endDate: j.end_date || j.start_date || today,
                        defaultCheckIn: j.default_check_in || '09:00', defaultCheckOut: j.default_check_out || '18:00', priority: j.priority || 'ปกติ',
                        fixReason: j.fix_reason || '', notes: j.notes || '', createdBy: j.created_by || '', overallProgress: j.overall_progress || 0,
                        currentIssues: j.current_issues || '', updatedAt: j.updated_at,
                        subTasks: (j.sub_tasks || []).map(st => ({ id: st.id, title: st.title, isCompleted: st.is_completed })),
                        attachments: (j.attachments || []).map(at => ({ id: at.id, name: at.name, url: at.url, type: at.type })),
                        progressLogs: (j.progress_logs || []).map(pl => ({
                            id: pl.id, date: pl.log_date, text: pl.text, author: pl.author, workerIds: (pl.log_staff_assignments || []).map(lsa => lsa.staff_id)
                        })).sort((a, b) => new Date(b.date) - new Date(a.date) || b.id - a.id),
                        assignedStaffIds: uniqueStaffIds
                    };
                });
                setJobs(formattedJobs);
            }
        } catch (error) { console.error('Fetch Error:', error); }
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

    const handleStatusChange = async (job, newStatus) => {
        let fixReason = job.fixReason;
        if (newStatus === 'ต้องแก้ไข') { const reason = prompt('Reason:'); if (!reason) return; fixReason = reason; }
        await supabase.from('jobs').update({ status: newStatus, fix_reason: fixReason || '', updated_at: new Date().toISOString() }).eq('id', job.id);
        await fetchData(true);
    };

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
                <div className="scheduler-grid-wrapper">
                    <table className="scheduler-grid">
                        <thead><tr><th className="staff-col">พนักงาน</th>{currentRangeDates.map(d => (<th key={d} className={`date-col ${d === today ? 'today' : ''}`}><div className="day-name">{formatDay(d)}</div><div className="day-num">{parseISO(d).getDate()}</div></th>))}</tr></thead>
                        <tbody>{staff.filter(s => s.isActive).map(s => (
                            <tr key={s.id}>
                                <td className="staff-cell"><div className="staff-info"><div className="staff-avatar" style={{ backgroundColor: getRoleColor(s.role) }}>{s.nickname.charAt(0)}</div><div className="staff-text"><span className="staff-nickname">{s.nickname}</span><span className="staff-role">{s.role}</span></div></div></td>
                                {currentRangeDates.map(d => {
                                    const cellAllocs = allocations.filter(a => a.staff_id === s.id && a.date === d);
                                    return (<td key={d} className={`slot-cell ${d === today ? 'today' : ''}`} onClick={() => { setSelectedStaffId(s.id); setReportDate(d); setShowReportModal(true); }}>
                                        {cellAllocs.map(a => { const job = jobs.find(j => j.id === a.job_id); if (!job) return null; return (<div key={a.id} className={`job-card status-${statusToKey(job.status)}`} onClick={e => { e.stopPropagation(); setSelectedJob(job); }}><div className="job-card-title">{job.projectName}</div><div className="job-card-meta">{job.qtNumber}</div></div>); })}
                                    </td>);
                                })}
                            </tr>
                        ))}</tbody>
                    </table>
                </div>
            </div>
            {selectedJob && <JobDetailModal job={selectedJob} staff={staff} user={user} onClose={() => setSelectedJob(null)} onEdit={() => { setEditingJob(selectedJob); setShowJobModal(true); }} onDelete={() => handleDeleteJob(selectedJob.id)} onStatusChange={handleStatusChange} onUpdate={() => fetchData(true)} />}
            {(showJobModal || editingJob) && <JobModal job={editingJob} staff={staff} clientSuggestions={uniqueClients} onSave={handleSaveJob} onClose={() => { setShowJobModal(false); setEditingJob(null); }} />}
            {showReportModal && <DailyReportModal staff={staff.find(s => s.id === selectedStaffId)} dateStr={reportDate} allocations={allocations.filter(a => a.staff_id === selectedStaffId && a.date === reportDate)} jobs={jobs} onClose={() => setShowReportModal(false)} />}
        </div>
    );
}

function JobModal({ job, staff, clientSuggestions = [], onSave, onClose }) {
    const [form, setForm] = useState(job ? { ...job, assignedStaffIds: job.assignedStaffIds || [] } : createJob());
    const [selectionType, setSelectionType] = useState(['พี่ยุ้ย', 'แพร', 'ไอซ์'].includes(form.createdBy) ? form.createdBy : (form.createdBy ? 'อื่นๆ' : ''));
    const update = (f, v) => setForm(prev => ({ ...prev, [f]: v }));
    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal" style={{ maxWidth: '700px' }}>
                <div className="modal-header"><h2>{job ? 'แก้ไขงาน' : 'เพิ่มงานใหม่'}</h2><button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button></div>
                <div className="modal-body"><div className="form-grid">
                    <div className="input-group"><label>เลขที่ QT</label><input className="input" value={form.qtNumber} onChange={e => update('qtNumber', e.target.value)} /></div>
                    <div className="input-group"><label>ชื่อโปรเจกต์</label><input className="input" value={form.projectName} onChange={e => update('projectName', e.target.value)} /></div>
                    <div className="input-group">
                        <label>ชื่อลูกค้า</label>
                        <input className="input" value={form.clientName} onChange={e => update('clientName', e.target.value)} list="client-suggestions-scheduler" />
                        <datalist id="client-suggestions-scheduler">{clientSuggestions.map(c => <option key={c} value={c} />)}</datalist>
                    </div>
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
                    <div className="input-group full-width" style={{ borderTop: '1px solid var(--border-primary)', paddingTop: '16px' }}>
                        <label>ทีมงานประจำโปรเจกต์</label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                            {staff.map(s => {
                                const isSel = (form.assignedStaffIds || []).includes(s.id);
                                return (<button key={s.id} type="button" onClick={() => update('assignedStaffIds', isSel ? form.assignedStaffIds.filter(id => id !== s.id) : [...(form.assignedStaffIds || []), s.id])}
                                    style={{ padding: '4px 12px', borderRadius: '20px', border: '1px solid', borderColor: isSel ? 'var(--brand-primary)' : 'var(--border-primary)', background: isSel ? 'var(--brand-primary)' : 'transparent', color: isSel ? '#fff' : 'var(--text-primary)', fontSize: '12px' }}>{s.nickname}</button>);
                            })}
                        </div>
                    </div>
                    <div className="input-group full-width"><label>หมายเหตุ</label><textarea className="textarea" value={form.notes} onChange={e => update('notes', e.target.value)} /></div>
                </div></div>
                <div className="modal-footer"><button className="btn btn-secondary" onClick={onClose}>ยกเลิก</button><button className="btn btn-primary" onClick={() => onSave(form)}>บันทึก</button></div>
            </div>
        </div>
    );
}

function JobDetailModal({ job, staff, user, onClose, onEdit, onDelete, onUpdate, onStatusChange }) {
    const statusKey = statusToKey(job.status);
    const [isAdding, setIsAdding] = useState(false);
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
                    <div className="detail-row"><span className={`badge badge-${statusKey}`}>{job.status}</span><span className="job-type-tag">{job.jobType}</span><span style={{ color: getPriorityColor(job.priority), fontWeight: 600 }}>{job.priority}</span></div>
                    <div className="detail-section" style={{ background: 'var(--bg-tertiary)', padding: '16px', borderRadius: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}><h4 style={{ margin: 0 }}>ความคืบหน้า: {job.overallProgress}%</h4><input type="range" min="0" max="100" value={job.overallProgress} onChange={async e => { const val = parseInt(e.target.value); await supabase.from('jobs').update({ overall_progress: val, status: val === 100 ? 'เสร็จสมบูรณ์' : job.status }).eq('id', job.id); onUpdate(); }} /></div>
                        <div style={{ display: 'flex', gap: '8px' }}><input className="input" placeholder="ปัญหาที่พบ..." value={localIssues} onChange={e => setLocalIssues(e.target.value)} style={{ flex: 1 }} /><button className="btn btn-secondary btn-sm" onClick={async () => { await supabase.from('jobs').update({ current_issues: localIssues }).eq('id', job.id); onUpdate(); }}>อัปเดตปัญหา</button></div>
                    </div>
                    <div className="detail-section">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}><h4>ทีมงาน ({(job.assignedStaffIds || []).length})</h4><button className="btn btn-sm btn-outline" onClick={() => setIsAdding(!isAdding)}>{isAdding ? 'ยกเลิก' : '+ เพิ่ม'}</button></div>
                        {isAdding && (<select className="select" onChange={async e => { await supabase.from('allocations').insert([{ job_id: job.id, staff_id: e.target.value, date: new Date().toISOString().split('T')[0], status: 'ได้รับมอบหมาย' }]); onUpdate(); setIsAdding(false); }} defaultValue="" style={{ marginBottom: '8px' }}><option value="" disabled>เลือกพนักงาน</option>{staff.filter(s => !(job.assignedStaffIds || []).includes(s.id)).map(s => <option key={s.id} value={s.id}>{s.nickname}</option>)}</select>)}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>{(job.assignedStaffIds || []).map(id => { const s = staff.find(st => st.id === id); if (!s) return null; return (<span key={s.id} className="staff-chip">{s.nickname} <button onClick={async () => { if (confirm('Remove?')) { await supabase.from('allocations').delete().eq('job_id', job.id).eq('staff_id', s.id).eq('date', new Date().toISOString().split('T')[0]); onUpdate(); } }} style={{ border: 'none', background: 'transparent', color: '#ef4444', marginLeft: '4px' }}>✕</button></span>); })}</div>
                    </div>
                    <div className="detail-section">
                        <h4>บันทึกความคืบหน้า (โดย: {user?.user_metadata?.nickname || user?.email?.split('@')[0]})</h4>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>{staff.map(s => (<button key={s.id} onClick={() => setLogStaffIds(prev => prev.includes(s.id) ? prev.filter(id => id !== s.id) : [...prev, s.id])} style={{ border: 'none', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', background: logStaffIds.includes(s.id) ? 'var(--brand-primary)' : 'var(--bg-tertiary)', color: logStaffIds.includes(s.id) ? '#fff' : 'inherit' }}>{s.nickname}</button>))}</div>
                        <div style={{ display: 'flex', gap: '8px' }}><textarea className="input" placeholder="พิมพ์บันทึก..." value={newLog} onChange={e => setNewLog(e.target.value)} style={{ flex: 1, minHeight: '60px' }} /><button className="btn btn-primary" onClick={handleAddLog}>บันทึก</button></div>
                        <div className="log-list" style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '250px', overflowY: 'auto' }}>{(job.progressLogs || []).map(log => (<div key={log.id} style={{ padding: '10px', background: '#fff', borderRadius: '6px', border: '1px solid var(--border-primary)' }}><div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '11px', color: 'var(--text-tertiary)' }}><span>{formatDate(log.date)} • โดย: {log.author}</span><button onClick={async () => { if (confirm('Delete?')) { await supabase.from('progress_logs').delete().eq('id', log.id); onUpdate(); } }} style={{ border: 'none', background: 'transparent', color: '#ef4444' }}>ลบ</button></div><p style={{ margin: 0, fontSize: '13px' }}>{log.text}</p></div>))}</div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function DailyReportModal({ staff, dateStr, allocations, jobs, onClose }) {
    if (!staff || !dateStr) return null;
    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal" style={{ maxWidth: '500px' }}>
                <div className="modal-header"><h2>งานของ: {staff.nickname}</h2><button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button></div>
                <div className="modal-body"><p style={{ fontWeight: 600, marginBottom: '16px' }}>วันที่: {formatDate(dateStr)}</p>{allocations.length === 0 ? <p>ไม่มีงานที่มอบหมายในวันนี้</p> : (allocations.map(alloc => { const job = jobs.find(j => j.id === alloc.job_id); return (<div key={alloc.id} style={{ padding: '12px', border: '1px solid var(--border-primary)', borderRadius: '8px', marginBottom: '8px' }}><div style={{ fontWeight: 700 }}>{job?.projectName}</div><div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{job?.qtNumber}</div></div>); }))}</div>
            </div>
        </div>
    );
}
