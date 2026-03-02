import { useState, useMemo, useEffect } from 'react';
import {
    Plus, Search, Filter, Trash2, Edit3, Eye, ChevronDown,
    AlertCircle, CheckCircle2, Clock, Loader, Download, Upload, Loader2, AlertTriangle
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { getJobs, saveJob, deleteJob, getStaff, getAllocationsByJob, importJobs, exportAllData } from '../data/store';
import { createJob, JOB_STATUSES, JOB_TYPES, PRIORITIES } from '../data/models';
import { formatDate, getStatusColor, getPriorityColor, statusToKey, jobTypeToKey, compressImage } from '../utils/helpers';
import { read, utils, writeFile } from 'xlsx';
import './Jobs.css';

export default function Jobs({ user }) {
    const [jobs, setJobs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('ทุกสถานะ');
    const [typeFilter, setTypeFilter] = useState('ทุกประเภท');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editingJob, setEditingJob] = useState(null);
    const [showDetailModal, setShowDetailModal] = useState(false);
    const [detailJob, setDetailJob] = useState(null);
    const [staff, setStaff] = useState([]);
    
    // Multi-select state
    const [selectedIds, setSelectedIds] = useState([]);

    useEffect(() => {
        fetchData();
        fetchStaff();
    }, []);

    const fetchStaff = async () => {
        const { data } = await supabase.from('staff').select('*').eq('is_active', true);
        if (data) {
            setStaff(data.map(s => ({
                id: s.id,
                nickname: s.nickname,
                fullName: s.full_name
            })));
        }
    };

    const fetchData = async () => {
        setLoading(true);
        try {
            // Fetch Allocations first
            const { data: allocData, error: allocError } = await supabase.from('allocations').select('job_id, staff_id');
            if (allocError) throw allocError;

            const { data, error } = await supabase
                .from('jobs')
                .select(`
                    *,
                    sub_tasks (*),
                    attachments (*),
                    progress_logs (*, log_staff_assignments(staff_id))
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;

            const formatted = data.map(j => {
                const jobAllocs = (allocData || []).filter(a => a.job_id === j.id);
                const uniqueStaffIds = [...new Set(jobAllocs.map(a => a.staff_id))];

                return {
                    id: j.id,
                    qtNumber: j.qt_number,
                    projectName: j.project_name,
                    clientName: j.client_name,
                    jobType: j.job_type,
                    status: j.status,
                    startDate: j.start_date,
                    endDate: j.end_date,
                    defaultCheckIn: j.default_check_in,
                    defaultCheckOut: j.default_check_out,
                    priority: j.priority,
                    fixReason: j.fix_reason,
                    notes: j.notes,
                    createdBy: j.created_by,
                    overallProgress: j.overall_progress,
                    currentIssues: j.current_issues,
                    createdAt: j.created_at,
                    updatedAt: j.updated_at,
                    subTasks: (j.sub_tasks || []).map(st => ({
                        id: st.id,
                        title: st.title,
                        isCompleted: st.is_completed
                    })),
                    attachments: (j.attachments || []).map(a => ({
                        id: a.id,
                        name: a.name,
                        url: a.url,
                        type: a.type
                    })),
                    progressLogs: (j.progress_logs || []).map(pl => ({
                        id: pl.id,
                        date: pl.log_date,
                        text: pl.text,
                        author: pl.author,
                        workerIds: (pl.log_staff_assignments || []).map(lsa => lsa.staff_id)
                    })).sort((a, b) => new Date(b.id) - new Date(a.id)),
                    assignedStaffIds: uniqueStaffIds
                };
            });

            setJobs(formatted);
            setSelectedIds([]); 
        } catch (error) {
            console.error('Error fetching jobs:', error);
        } finally {
            setLoading(false);
        }
    };

    const refresh = fetchData;

    const filtered = useMemo(() => {
        return jobs.filter(j => {
            const matchSearch = !search ||
                (j.projectName || '').toLowerCase().includes(search.toLowerCase()) ||
                (j.clientName || '').toLowerCase().includes(search.toLowerCase()) ||
                (j.qtNumber || '').toLowerCase().includes(search.toLowerCase());
            const matchStatus = statusFilter === 'ทุกสถานะ' || j.status === statusFilter;
            const matchType = typeFilter === 'ทุกประเภท' || j.jobType === typeFilter;
            
            const jobStart = j.startDate;
            const jobEnd = j.endDate;
            const matchDateFrom = !dateFrom || jobEnd >= dateFrom;
            const matchDateTo = !dateTo || jobStart <= dateTo;

            return matchSearch && matchStatus && matchType && matchDateFrom && matchDateTo;
        });
    }, [jobs, search, statusFilter, typeFilter, dateFrom, dateTo]);

    // Get unique client names for suggestions
    const uniqueClients = useMemo(() => {
        const clients = jobs.map(j => j.clientName).filter(Boolean);
        return [...new Set(clients)].sort((a, b) => a.localeCompare(b, 'th'));
    }, [jobs]);

    // Multi-select handlers
    const toggleSelectAll = () => {
        if (selectedIds.length === filtered.length && filtered.length > 0) {
            setSelectedIds([]);
        } else {
            setSelectedIds(filtered.map(j => j.id));
        }
    };

    const toggleSelect = (id) => {
        setSelectedIds(prev => 
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const handleBulkDelete = async () => {
        if (!selectedIds.length) return;
        if (confirm(`คุณต้องการลบงานที่เลือกทั้ง ${selectedIds.length} รายการใช่หรือไม่?`)) {
            try {
                setLoading(true);
                const { error } = await supabase
                    .from('jobs')
                    .delete()
                    .in('id', selectedIds);
                
                if (error) throw error;
                alert('ลบข้อมูลเรียบร้อยแล้ว');
                fetchData();
            } catch (error) {
                console.error('Bulk delete error:', error);
                alert('เกิดข้อผิดพลาดในการลบข้อมูล');
            } finally {
                setLoading(false);
            }
        }
    };

    const handleSave = async (job) => {
        try {
            const dbData = {
                qt_number: job.qtNumber,
                project_name: job.projectName,
                client_name: job.clientName,
                job_type: job.jobType,
                status: job.status,
                start_date: job.startDate,
                end_date: job.endDate,
                default_check_in: job.defaultCheckIn,
                default_check_out: job.defaultCheckOut,
                priority: job.priority,
                notes: job.notes,
                created_by: job.createdBy,
                overall_progress: job.overallProgress,
                current_issues: job.currentIssues,
                updated_at: new Date().toISOString()
            };

            let jobId = job.id;

            if (editingJob && job.id) {
                const { error } = await supabase.from('jobs').update(dbData).eq('id', job.id);
                if (error) throw error;
            } else {
                const { data, error } = await supabase.from('jobs').insert([dbData]).select();
                if (error) throw error;
                jobId = data[0].id;
            }

            if (job.assignedStaffIds?.length > 0) {
                const { data: existingAllocs } = await supabase.from('allocations').select('staff_id').eq('job_id', jobId);
                const existingStaffIds = (existingAllocs || []).map(a => a.staff_id);
                const newStaffToAllocate = job.assignedStaffIds.filter(sid => !existingStaffIds.includes(sid));
                
                if (newStaffToAllocate.length > 0) {
                    const allocData = newStaffToAllocate.map(sid => ({
                        job_id: jobId,
                        staff_id: sid,
                        date: job.startDate,
                        status: 'ได้รับมอบหมาย'
                    }));
                    await supabase.from('allocations').insert(allocData);
                }
            }

            await supabase.from('sub_tasks').delete().eq('job_id', jobId);
            if (job.subTasks?.length > 0) {
                const subTasksData = job.subTasks.map(st => ({
                    job_id: jobId,
                    title: st.title,
                    is_completed: st.isCompleted
                }));
                await supabase.from('sub_tasks').insert(subTasksData);
            }

            refresh();
            setShowModal(false);
            setEditingJob(null);
        } catch (error) {
            console.error('Error saving job:', error);
            alert('ไม่สามารถบันทึกข้อมูลได้');
        }
    };

    const handleDelete = async (id) => {
        if (confirm('ยืนยันการลบงานนี้?')) {
            const { error } = await supabase.from('jobs').delete().eq('id', id);
            if (error) alert('Error deleting job');
            else refresh();
        }
    };

    const handleStatusChange = async (job, newStatus) => {
        let fixReason = job.fixReason;
        if (newStatus === 'ต้องแก้ไข') {
            const reason = prompt('ระบุเหตุผลที่ต้องแก้ไข:');
            if (!reason) return;
            fixReason = reason;
        } else {
            fixReason = '';
        }

        try {
            const { error } = await supabase.from('jobs').update({
                status: newStatus,
                fix_reason: fixReason,
                updated_at: new Date().toISOString()
            }).eq('id', job.id);

            if (error) throw error;
            refresh();
            
            if (detailJob && detailJob.id === job.id) {
                setDetailJob({ ...job, status: newStatus, fixReason });
            }
        } catch (error) {
            console.error('Error updating status:', error);
        }
    };

    const openDetail = (job) => {
        setDetailJob(job);
        setShowDetailModal(true);
    };

    return (
        <div className="page-content">
            <div className="page-header">
                <div>
                    <h1>จัดการงาน</h1>
                    <p className="subtitle">มีงานทั้งหมด {jobs.length} รายการ</p>
                </div>
                <button className="btn btn-primary" onClick={() => { setEditingJob(null); setShowModal(true); }}>
                    <Plus size={16} /> เพิ่มงานใหม่
                </button>
            </div>

            {/* Filters */}
            <div className="filters-bar">
                <div className="search-input">
                    <Search size={16} />
                    <input
                        type="text"
                        placeholder="ค้นหา..."
                        className="input"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
                <select className="select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                    <option value="ทุกสถานะ">ทุกสถานะ</option>
                    {JOB_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
            </div>

            {/* Job Data Table */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="table-wrapper">
                    <table className="jobs-table">
                        <thead>
                            <tr>
                                <th>เลขที่ QT</th>
                                <th>ชื่อโปรเจกต์</th>
                                <th>ลูกค้า</th>
                                <th>ประเภท</th>
                                <th>สถานะ</th>
                                <th style={{ textAlign: 'right' }}>จัดการ</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(job => (
                                <tr key={job.id} onClick={() => openDetail(job)} style={{ cursor: 'pointer' }}>
                                    <td style={{ fontFamily: 'monospace' }}>{job.qtNumber || '-'}</td>
                                    <td><strong>{job.projectName}</strong></td>
                                    <td>{job.clientName}</td>
                                    <td><span className={`job-type-badge type-${jobTypeToKey(job.jobType)}`}>{job.jobType}</span></td>
                                    <td><span className={`badge badge-${statusToKey(job.status)}`}>{job.status}</span></td>
                                    <td>
                                        <div className="table-actions" style={{ justifyContent: 'flex-end' }}>
                                            <button className="btn btn-ghost btn-icon btn-sm" onClick={(e) => { e.stopPropagation(); setEditingJob(job); setShowModal(true); }}><Edit3 size={16} /></button>
                                            <button className="btn btn-ghost btn-icon btn-sm" onClick={(e) => { e.stopPropagation(); handleDelete(job.id); }}><Trash2 size={16} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Job Modal */}
            {showModal && (
                <JobModal
                    job={editingJob}
                    staff={staff}
                    clientSuggestions={uniqueClients}
                    onSave={handleSave}
                    onClose={() => { setShowModal(false); setEditingJob(null); }}
                />
            )}

            {/* Detail Modal */}
            {showDetailModal && detailJob && (
                <JobDetailModal
                    job={detailJob}
                    staff={staff}
                    user={user}
                    onClose={() => setShowDetailModal(false)}
                    onStatusChange={handleStatusChange}
                    onUpdate={() => {
                        refresh();
                        const updated = jobs.find(j => j.id === detailJob.id);
                        if (updated) setDetailJob({...updated});
                    }}
                />
            )}
        </div>
    );
}

function JobModal({ job, staff, clientSuggestions = [], onSave, onClose }) {
    const [form, setForm] = useState(job || createJob());
    const initialSelectionType = ['พี่ยุ้ย', 'แพร', 'ไอซ์'].includes(form.createdBy) ? form.createdBy : (form.createdBy ? 'อื่นๆ' : '');
    const [selectionType, setSelectionType] = useState(initialSelectionType);
    const [subTaskInput, setSubTaskInput] = useState('');
    
    const update = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

    const handleAddSubTask = () => {
        if (!subTaskInput.trim()) return;
        const newSubTask = { id: Date.now(), title: subTaskInput.trim(), isCompleted: false };
        update('subTasks', [...(form.subTasks || []), newSubTask]);
        setSubTaskInput('');
    };

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal" style={{ maxWidth: '700px' }}>
                <div className="modal-header">
                    <h2>{job ? 'แก้ไขงาน' : 'เพิ่มงานใหม่'}</h2>
                    <button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button>
                </div>
                <div className="modal-body">
                    <div className="form-grid">
                        <div className="input-group">
                            <label>เลขที่ QT</label>
                            <input className="input" value={form.qtNumber} onChange={e => update('qtNumber', e.target.value)} placeholder="QT-2625-XXX" />
                        </div>
                        <div className="input-group">
                            <label>ชื่อโปรเจกต์</label>
                            <input className="input" value={form.projectName} onChange={e => update('projectName', e.target.value)} placeholder="เช่น Okamura-DTGO" />
                        </div>
                        <div className="input-group">
                            <label>ชื่อลูกค้า</label>
                            <input 
                                className="input" 
                                value={form.clientName} 
                                onChange={e => update('clientName', e.target.value)} 
                                placeholder="เช่น Okamura" 
                                list="client-suggestions"
                            />
                            <datalist id="client-suggestions">
                                {clientSuggestions.map(client => (
                                    <option key={client} value={client} />
                                ))}
                            </datalist>
                        </div>
                        <div className="input-group">
                            <label>เซลล์ที่รับผิดชอบ</label>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <select 
                                    className="select" 
                                    value={selectionType} 
                                    onChange={e => {
                                        const val = e.target.value;
                                        setSelectionType(val);
                                        if (val !== 'อื่นๆ') update('createdBy', val);
                                    }}
                                >
                                    <option value="">-- เลือกผู้ลงชื่อ --</option>
                                    <option value="พี่ยุ้ย">พี่ยุ้ย</option>
                                    <option value="แพร">แพร</option>
                                    <option value="ไอซ์">ไอซ์</option>
                                    <option value="อื่นๆ">อื่นๆ (โปรดระบุ)</option>
                                </select>
                                {selectionType === 'อื่นๆ' && (
                                    <input 
                                        className="input" 
                                        placeholder="ระบุชื่อผู้รับผิดชอบ..." 
                                        value={form.createdBy} 
                                        onChange={e => update('createdBy', e.target.value)}
                                    />
                                )}
                            </div>
                        </div>
                        <div className="input-group">
                            <label>ประเภทงาน</label>
                            <select className="select" value={form.jobType} onChange={e => update('jobType', e.target.value)}>
                                {JOB_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </div>
                        <div className="input-group">
                            <label>สถานะ</label>
                            <select className="select" value={form.status} onChange={e => update('status', e.target.value)}>
                                {JOB_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        <div className="form-row">
                            <div className="input-group"><label>วันที่เริ่ม</label><input className="input" type="date" value={form.startDate} onChange={e => update('startDate', e.target.value)} /></div>
                            <div className="input-group"><label>วันที่สิ้นสุด</label><input className="input" type="date" value={form.endDate} onChange={e => update('endDate', e.target.value)} /></div>
                        </div>
                        <div className="input-group full-width" style={{ borderTop: '1px solid var(--border-primary)', paddingTop: '16px' }}>
                            <label>ทีมงานประจำโปรเจกต์</label>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                                {staff.map(s => {
                                    const isSelected = (form.assignedStaffIds || []).includes(s.id);
                                    return (
                                        <button
                                            key={s.id}
                                            type="button"
                                            onClick={() => update('assignedStaffIds', isSelected ? form.assignedStaffIds.filter(id => id !== s.id) : [...(form.assignedStaffIds || []), s.id])}
                                            style={{
                                                padding: '4px 12px', borderRadius: '20px', border: '1px solid',
                                                borderColor: isSelected ? 'var(--brand-primary)' : 'var(--border-primary)',
                                                background: isSelected ? 'var(--brand-primary)' : 'transparent',
                                                color: isSelected ? '#fff' : 'var(--text-primary)', fontSize: '12px'
                                            }}
                                        >
                                            {s.nickname}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="input-group full-width"><label>หมายเหตุ</label><textarea className="textarea" value={form.notes} onChange={e => update('notes', e.target.value)} /></div>
                    </div>
                </div>
                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>ยกเลิก</button>
                    <button className="btn btn-primary" onClick={() => onSave(form)}>บันทึก</button>
                </div>
            </div>
        </div>
    );
}

function JobDetailModal({ job, staff, user, onClose, onUpdate, onStatusChange }) {
    const statusClass = statusToKey(job.status);
    const [isAdding, setIsAdding] = useState(false);
    const [newLog, setNewLog] = useState('');
    const [logStaffIds, setLogStaffIds] = useState([]);
    const [localIssues, setLocalIssues] = useState(job.currentIssues || '');

    useEffect(() => {
        setLocalIssues(job.currentIssues || '');
    }, [job.id, job.currentIssues]); 

    const handleAddLog = async () => {
        if (!newLog.trim()) return;
        const authorName = user?.user_metadata?.nickname || user?.email?.split('@')[0] || 'Admin';
        try {
            const { data, error } = await supabase.from('progress_logs').insert([{
                job_id: job.id, log_date: new Date().toISOString().split('T')[0], text: newLog, author: authorName
            }]).select();
            if (error) throw error;
            if (logStaffIds.length > 0) {
                await supabase.from('log_staff_assignments').insert(logStaffIds.map(sid => ({ log_id: data[0].id, staff_id: sid })));
            }
            setNewLog(''); setLogStaffIds([]); onUpdate();
        } catch (error) { console.error(error); }
    };

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal" style={{ maxWidth: '700px' }}>
                <div className="modal-header">
                    <div><h2>{job.projectName}</h2><span className="subtitle">{job.qtNumber} • {job.clientName}</span></div>
                    <button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button>
                </div>
                <div className="modal-body">
                    <div className="detail-row">
                        <span className={`badge badge-${statusClass}`}>{job.status}</span>
                        <span style={{ color: getPriorityColor(job.priority), fontWeight: 600 }}>{job.priority}</span>
                    </div>
                    <div className="detail-section" style={{ background: 'var(--bg-tertiary)', padding: '16px', borderRadius: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                            <h4 style={{ margin: 0 }}>ความคืบหน้า: {job.overallProgress}%</h4>
                            <input type="range" min="0" max="100" value={job.overallProgress} onChange={async e => {
                                const val = parseInt(e.target.value);
                                await supabase.from('jobs').update({ overall_progress: val, status: val === 100 ? 'เสร็จสมบูรณ์' : job.status }).eq('id', job.id);
                                onUpdate();
                            }} />
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <input className="input" placeholder="ปัญหาที่พบ..." value={localIssues} onChange={e => setLocalIssues(e.target.value)} style={{ flex: 1 }} />
                            <button className="btn btn-secondary btn-sm" onClick={async () => { await supabase.from('jobs').update({ current_issues: localIssues }).eq('id', job.id); onUpdate(); }}>อัปเดตปัญหา</button>
                        </div>
                    </div>
                    <div className="detail-section">
                        <h4>บันทึกความคืบหน้า (โดย: {user?.user_metadata?.nickname || user?.email?.split('@')[0]})</h4>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                            {staff.map(s => (
                                <button key={s.id} onClick={() => setLogStaffIds(prev => prev.includes(s.id) ? prev.filter(id => id !== s.id) : [...prev, s.id])}
                                    style={{ border: 'none', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', background: logStaffIds.includes(s.id) ? 'var(--brand-primary)' : 'var(--bg-tertiary)', color: logStaffIds.includes(s.id) ? '#fff' : 'inherit' }}>
                                    {s.nickname}
                                </button>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <textarea className="input" placeholder="พิมพ์บันทึก..." value={newLog} onChange={e => setNewLog(e.target.value)} style={{ flex: 1, minHeight: '60px' }} />
                            <button className="btn btn-primary" onClick={handleAddLog}>บันทึก</button>
                        </div>
                        <div className="log-list" style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '250px', overflowY: 'auto' }}>
                            {(job.progressLogs || []).map(log => (
                                <div key={log.id} style={{ padding: '10px', background: '#fff', borderRadius: '6px', border: '1px solid var(--border-primary)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                        <span>{formatDate(log.date)} • โดย: {log.author}</span>
                                    </div>
                                    <p style={{ margin: 0, fontSize: '13px' }}>{log.text}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
                <div className="modal-footer"><button className="btn btn-secondary" onClick={onClose}>ปิด</button></div>
            </div>
        </div>
    );
}
