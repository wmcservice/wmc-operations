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

export default function Jobs() {
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

            const formatted = data.map(j => ({
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
                assignedStaffIds: [] 
            }));

            setJobs(formatted);
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
                // Update Job
                const { error } = await supabase.from('jobs').update(dbData).eq('id', job.id);
                if (error) throw error;
            } else {
                // Insert Job (Let Supabase generate ID)
                const { data, error } = await supabase.from('jobs').insert([dbData]).select();
                if (error) throw error;
                jobId = data[0].id;
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

            await supabase.from('attachments').delete().eq('job_id', jobId);
            if (job.attachments?.length > 0) {
                const attachmentsData = job.attachments.map(a => ({
                    job_id: jobId,
                    name: a.name,
                    url: a.url,
                    type: a.type
                }));
                await supabase.from('attachments').insert(attachmentsData);
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

    const handleExportJobs = () => {
        const data = getJobs();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `wmc-jobs-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleDownloadTemplate = () => {
        const templateData = [
            {
                'เลขที่ QT': 'QT-2625-001',
                'ชื่อโปรเจกต์': 'ตัวอย่างชื่อโครงการ',
                'ชื่อลูกค้า': 'บริษัทลูกค้า',
                'ผู้รับผิดชอบ': 'พี่ยุ้ย',
                'ประเภทงาน': 'ติดตั้ง',
                'สถานะ': 'กำลังดำเนินการ',
                'ความสำคัญ': 'ปกติ',
                'วันที่เริ่ม': '2026-02-25',
                'วันที่สิ้นสุด': '2026-02-28',
                'เวลาเข้า': '09:00',
                'เวลาออก': '18:00',
                'ความคืบหน้า (%)': 50,
                'ปัญหาที่พบ': 'รอของเข้าเพิ่ม',
                'รายชื่อทีมงาน (ชื่อเล่นคั่นด้วยคอมม่า)': 'ตี๋, บอล, หนู',
                'หมายเหตุ': 'ข้อความระบุเพิ่มเติม...'
            }
        ];
        const worksheet = utils.json_to_sheet(templateData);
        const workbook = utils.book_new();
        utils.book_append_sheet(workbook, worksheet, 'Template');
        writeFile(workbook, 'wmc-jobs-template.xlsx');
    };

    const handleImportJobs = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            setLoading(true);
            const data = await file.arrayBuffer();
            const workbook = read(data, { cellDates: true }); // Ensure dates are parsed
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = utils.sheet_to_json(worksheet);
            
            // Get latest staff from state or fetch if empty
            let currentStaff = staff;
            if (currentStaff.length === 0) {
                const { data: sData } = await supabase.from('staff').select('id, nickname, full_name').eq('is_active', true);
                currentStaff = (sData || []).map(s => ({ id: s.id, nickname: s.nickname, fullName: s.full_name }));
            }

            // Helper to clean and format date to YYYY-MM-DD
            const parseDate = (val) => {
                if (!val) return new Date().toISOString().split('T')[0];
                try {
                    const d = new Date(val);
                    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
                } catch (e) {}
                return new Date().toISOString().split('T')[0];
            };

            // Map Excel data to Job model
            const newJobs = jsonData.map(row => {
                const nicknames = row['รายชื่อทีมงาน (ชื่อเล่นคั่นด้วยคอมม่า)'] 
                    ? String(row['รายชื่อทีมงาน (ชื่อเล่นคั่นด้วยคอมม่า)']).split(',').map(n => n.trim()) 
                    : [];
                
                const staffIds = nicknames
                    .map(name => currentStaff.find(s => 
                        (s.nickname && s.nickname.toLowerCase() === name.toLowerCase()) || 
                        (s.fullName && s.fullName.toLowerCase().includes(name.toLowerCase()))
                    )?.id)
                    .filter(Boolean);

                return {
                    qtNumber: String(row['เลขที่ QT'] || row.qtNumber || ''),
                    projectName: row['ชื่อโปรเจกต์'] || row.projectName || '',
                    clientName: row['ชื่อลูกค้า'] || row.clientName || '',
                    createdBy: row['ผู้รับผิดชอบ'] || row.createdBy || '',
                    jobType: row['ประเภทงาน'] || row.jobType || 'ติดตั้ง',
                    status: row['สถานะ'] || row.status || 'รอคิว',
                    priority: row['ความสำคัญ'] || row.priority || 'ปกติ',
                    startDate: parseDate(row['วันที่เริ่ม'] || row.startDate),
                    endDate: parseDate(row['วันที่สิ้นสุด'] || row.endDate),
                    defaultCheckIn: row['เวลาเข้า'] || row.defaultCheckIn || '09:00',
                    defaultCheckOut: row['เวลาออก'] || row.defaultCheckOut || '18:00',
                    overallProgress: parseInt(row['ความคืบหน้า (%)'] || 0) || 0,
                    currentIssues: row['ปัญหาที่พบ'] || '',
                    notes: row['หมายเหตุ'] || row.notes || '',
                    assignedStaffIds: staffIds
                };
            }).filter(j => j.projectName);

            if (newJobs.length === 0) {
                alert('ไม่พบข้อมูลงานที่ถูกต้องในไฟล์ (กรุณาตรวจสอบชื่อโปรเจกต์)');
                setLoading(false);
                return;
            }

            if (confirm(`พบข้อมูลงาน ${newJobs.length} รายการ ต้องการนำเข้าข้อมูลเหล่านี้ใช่หรือไม่?`)) {
                let successCount = 0;
                let errorCount = 0;

                for (const job of newJobs) {
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

                        const { data: inserted, error } = await supabase.from('jobs').insert([dbData]).select();
                        if (error) throw error;

                        // Also add staff assignments (allocations) if provided
                        if (job.assignedStaffIds.length > 0 && inserted?.[0]?.id) {
                            const allocs = job.assignedStaffIds.map(sid => ({
                                job_id: inserted[0].id,
                                staff_id: sid,
                                date: job.startDate,
                                status: 'ได้รับมอบหมาย'
                            }));
                            await supabase.from('allocations').insert(allocs);
                        }
                        
                        successCount++;
                    } catch (err) {
                        console.error('Error importing job:', err);
                        errorCount++;
                    }
                }

                await fetchData();
                alert(`นำเข้าข้อมูลเรียบร้อย! สำเร็จ ${successCount} รายการ${errorCount > 0 ? `, ผิดพลาด ${errorCount} รายการ` : ''}`);
            }
        } catch (error) {
            console.error("Import Error:", error);
            alert('เกิดข้อผิดพลาดในการอ่านไฟล์: ' + error.message);
        } finally {
            setLoading(false);
            e.target.value = '';
        }
    };

    return (
        <div className="page-content">
            <div className="page-header">
                <div>
                    <h1>จัดการงาน</h1>
                    <p className="subtitle">มีงานทั้งหมด {jobs.length} รายการ • แสดงอยู่ {filtered.length} รายการ</p>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn btn-secondary" onClick={handleDownloadTemplate} title="ดาวน์โหลดไฟล์ตัวอย่าง">
                        <Download size={16} /> Template
                    </button>
                    <button className="btn btn-secondary" onClick={handleExportJobs}>
                        <Download size={16} /> Export
                    </button>
                    <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
                        <Upload size={16} /> Import Excel
                        <input type="file" accept=".xlsx, .xls" onChange={handleImportJobs} style={{ display: 'none' }} />
                    </label>
                    <button className="btn btn-primary" onClick={() => { setEditingJob(null); setShowModal(true); }}>
                        <Plus size={16} /> เพิ่มงานใหม่
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="filters-bar">
                <div className="search-input">
                    <Search size={16} />
                    <input
                        type="text"
                        placeholder="ค้นหาตามชื่อโปรเจกต์, ลูกค้า, เลขที่ QT..."
                        className="input"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
                
                <div className="date-filter-group">
                    <div className="date-input-with-label">
                        <span>เริ่ม:</span>
                        <input type="date" className="input input-sm" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                    </div>
                    <div className="date-input-with-label">
                        <span>ถึง:</span>
                        <input type="date" className="input input-sm" value={dateTo} onChange={e => setDateTo(e.target.value)} />
                    </div>
                    {(dateFrom || dateTo) && (
                        <button className="btn btn-ghost btn-sm" onClick={() => { setDateFrom(''); setDateTo(''); }} title="ล้างวันที่">
                            ล้าง
                        </button>
                    )}
                </div>

                <select className="select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                    <option value="ทุกสถานะ">ทุกสถานะ</option>
                    {JOB_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="select" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
                    <option value="ทุกประเภท">ทุกประเภท</option>
                    {JOB_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
            </div>

            {/* Job Data Table */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
                    <table className="jobs-table">
                        <thead>
                            <tr>
                                <th>เลขที่ QT</th>
                                <th>ชื่อโปรเจกต์</th>
                                <th>ลูกค้า</th>
                                <th>ผู้ดูแล</th>
                                <th>ประเภท</th>
                                <th>ความคืบหน้า</th>
                                <th>สถานะ</th>
                                <th style={{ textAlign: 'right' }}>จัดการ</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(job => {
                                const statusClass = statusToKey(job.status);
                                const typeClass = jobTypeToKey(job.jobType);
                                const isBlocked = job.currentIssues && job.currentIssues.trim() !== '';

                                return (
                                    <tr key={job.id} onClick={() => openDetail(job)} style={{ cursor: 'pointer' }}>
                                        <td style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: '12px' }}>{job.qtNumber || '-'}</td>
                                        <td>
                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                <strong style={{ fontSize: '14px' }}>{job.projectName}</strong>
                                                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{formatDate(job.startDate)} - {formatDate(job.endDate)}</span>
                                            </div>
                                        </td>
                                        <td>{job.clientName}</td>
                                        <td>
                                            {job.createdBy ? (
                                                <span className="owner-tag">👤 {job.createdBy}</span>
                                            ) : '-'}
                                        </td>
                                        <td><span className={`job-type-badge type-${typeClass}`}>{job.jobType}</span></td>
                                        <td style={{ minWidth: '120px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <div style={{ flex: 1, height: '6px', background: 'var(--bg-tertiary)', borderRadius: '3px', overflow: 'hidden' }}>
                                                    <div style={{ 
                                                        height: '100%', 
                                                        width: `${job.overallProgress || 0}%`, 
                                                        background: job.overallProgress >= 100 ? 'var(--status-completed)' : 'var(--brand-primary)' 
                                                    }}></div>
                                                </div>
                                                <span style={{ fontSize: '11px', fontWeight: 700, minWidth: '30px' }}>{job.overallProgress || 0}%</span>
                                            </div>
                                            {isBlocked && (
                                                <div style={{ fontSize: '10px', color: 'var(--status-needs-fix)', fontWeight: 600, marginTop: '2px', display: 'flex', alignItems: 'center', gap: '2px' }}>
                                                    <AlertTriangle size={10} /> ติดปัญหา
                                                </div>
                                            )}
                                        </td>
                                        <td>
                                            <span className={`badge badge-${statusClass}`} style={{ fontSize: '11px' }}>{job.status}</span>
                                        </td>
                                        <td>
                                            <div className="table-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '4px' }}>
                                                <button className="btn btn-ghost btn-icon btn-sm" onClick={(e) => { e.stopPropagation(); openDetail(job); }} title="View">
                                                    <Eye size={16} />
                                                </button>
                                                <button className="btn btn-ghost btn-icon btn-sm" onClick={(e) => { e.stopPropagation(); setEditingJob(job); setShowModal(true); }} title="Edit">
                                                    <Edit3 size={16} />
                                                </button>
                                                <button className="btn btn-ghost btn-icon btn-sm" onClick={(e) => { e.stopPropagation(); handleDelete(job.id); }} title="Delete">
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {filtered.length === 0 && (
                <div className="empty-state">
                    <Loader size={48} />
                    <h3>ไม่พบข้อมูลงาน</h3>
                    <p>ลองปรับตัวกรองหรือเพิ่มงานใหม่</p>
                </div>
            )}

            {/* Job Modal */}
            {showModal && (
                <JobModal
                    job={editingJob}
                    onSave={handleSave}
                    onClose={() => { setShowModal(false); setEditingJob(null); }}
                />
            )}

            {/* Detail Modal */}
            {showDetailModal && detailJob && (
                <JobDetailModal
                    job={detailJob}
                    staff={staff}
                    onClose={() => setShowDetailModal(false)}
                    onStatusChange={handleStatusChange}
                    onUpdate={() => {
                        refresh();
                        // Re-fetch the specific job to update the modal prop if needed
                        const updated = getJobs().find(j => j.id === detailJob.id);
                        if (updated) setDetailJob({...updated});
                    }}
                />
            )}
        </div>
    );
}

function JobModal({ job, onSave, onClose }) {
    const [form, setForm] = useState(job || createJob());
    const initialSelectionType = ['พี่ยุ้ย', 'แพร', 'ไอซ์'].includes(form.createdBy) ? form.createdBy : (form.createdBy ? 'อื่นๆ' : '');
    const [selectionType, setSelectionType] = useState(initialSelectionType);
    const [linkInput, setLinkInput] = useState({ name: '', url: '' });
    const [subTaskInput, setSubTaskInput] = useState('');
    
    const update = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

    const handleAddSubTask = () => {
        if (!subTaskInput.trim()) return;
        const newSubTask = {
            id: Date.now(),
            title: subTaskInput.trim(),
            isCompleted: false
        };
        const updatedTasks = [...(form.subTasks || []), newSubTask];
        update('subTasks', updatedTasks);
        setSubTaskInput('');
        
        // Auto-calculate progress if adding to existing completed ones
        calculateAndSetProgress(updatedTasks);
    };

    const removeSubTask = (id) => {
        const updatedTasks = (form.subTasks || []).filter(t => t.id !== id);
        update('subTasks', updatedTasks);
        calculateAndSetProgress(updatedTasks);
    };

    const calculateAndSetProgress = (tasks) => {
        if (!tasks || tasks.length === 0) {
            update('overallProgress', 0);
            return;
        }
        const completed = tasks.filter(t => t.isCompleted).length;
        const progress = Math.round((completed / tasks.length) * 100);
        update('overallProgress', progress);
        if (progress === 100) update('status', 'เสร็จสมบูรณ์');
    };

    const handleAddLink = () => {
        if (!linkInput.name || !linkInput.url) return;
        const newAttachment = {
            id: Date.now(),
            name: linkInput.name,
            url: linkInput.url,
            type: 'link'
        };
        update('attachments', [...(form.attachments || []), newAttachment]);
        setLinkInput({ name: '', url: '' });
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            let fileUrl = '';
            const isImage = file.type.startsWith('image/');
            const isPdf = file.type.includes('pdf');

            if (isImage) {
                fileUrl = await compressImage(file);
            } else {
                if (file.size > 1024 * 1024) {
                    alert('ไฟล์มีขนาดใหญ่เกินไป (จำกัด 1MB สำหรับ PDF)');
                    return;
                }
                const reader = new FileReader();
                fileUrl = await new Promise((resolve) => {
                    reader.onload = (ev) => resolve(ev.target.result);
                    reader.readAsDataURL(file);
                });
            }

            const newAttachment = {
                id: Date.now(),
                name: file.name,
                url: fileUrl,
                type: isPdf ? 'pdf' : 'image'
            };
            update('attachments', [...(form.attachments || []), newAttachment]);
        } catch (error) {
            console.error("Upload error:", error);
            alert('เกิดข้อผิดพลาดในการอัปโหลดไฟล์');
        }
    };

    const removeAttachment = (id) => {
        update('attachments', (form.attachments || []).filter(a => a.id !== id));
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
                            <input className="input" value={form.clientName} onChange={e => update('clientName', e.target.value)} placeholder="เช่น Okamura" />
                        </div>
                        <div className="input-group">
                            <label>ผู้รับผิดชอบงาน (ลงชื่อ)</label>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <select 
                                    className="select" 
                                    value={selectionType} 
                                    onChange={e => {
                                        const val = e.target.value;
                                        setSelectionType(val);
                                        if (val !== 'อื่นๆ') {
                                            update('createdBy', val);
                                        }
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
                                        value={['พี่ยุ้ย', 'แพร', 'ไอซ์'].includes(form.createdBy) ? '' : form.createdBy} 
                                        onChange={e => update('createdBy', e.target.value)}
                                        autoFocus
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
                            <label>ความสำคัญ</label>
                            <select className="select" value={form.priority} onChange={e => update('priority', e.target.value)}>
                                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                        </div>
                        <div className="input-group">
                            <label>สถานะ</label>
                            <select className="select" value={form.status} onChange={e => update('status', e.target.value)}>
                                {JOB_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        <div className="form-row">
                            <div className="input-group">
                                <label>วันที่เริ่ม</label>
                                <input className="input" type="date" value={form.startDate} onChange={e => update('startDate', e.target.value)} />
                            </div>
                            <div className="input-group">
                                <label>วันที่สิ้นสุด</label>
                                <input className="input" type="date" value={form.endDate} onChange={e => update('endDate', e.target.value)} />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="input-group">
                                <label><Clock size={14} /> เวลาเข้างาน (ดีฟอลต์)</label>
                                <input className="input" type="time" value={form.defaultCheckIn} onChange={e => update('defaultCheckIn', e.target.value)} />
                            </div>
                            <div className="input-group">
                                <label><Clock size={14} /> เวลาเลิกงาน (ดีฟอลต์)</label>
                                <input className="input" type="time" value={form.defaultCheckOut} onChange={e => update('defaultCheckOut', e.target.value)} />
                            </div>
                        </div>
                        <div className="input-group full-width">
                            <label>หมายเหตุ</label>
                            <textarea className="textarea" value={form.notes} onChange={e => update('notes', e.target.value)} placeholder="หมายเหตุเพิ่มเติม..." />
                        </div>

                        {/* Sub-tasks Section */}
                        <div className="input-group full-width" style={{ borderTop: '1px solid var(--border-primary)', paddingTop: '16px' }}>
                            <label>รายการงานย่อย (เพื่อคำนวณ % ความสำเร็จ)</label>
                            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                                <input 
                                    className="input" 
                                    placeholder="เพิ่มงานย่อย เช่น ติดตั้งโต๊ะ 10 ชุด, โหลดตู้ล็อคเกอร์..." 
                                    value={subTaskInput}
                                    onChange={e => setSubTaskInput(e.target.value)}
                                    onKeyPress={e => e.key === 'Enter' && (e.preventDefault(), handleAddSubTask())}
                                />
                                <button className="btn btn-secondary" onClick={handleAddSubTask}>+ เพิ่ม</button>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {(form.subTasks || []).map(t => (
                                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: '6px' }}>
                                        <input 
                                            type="checkbox" 
                                            checked={t.isCompleted} 
                                            onChange={(e) => {
                                                const updated = form.subTasks.map(st => st.id === t.id ? {...st, isCompleted: e.target.checked} : st);
                                                calculateAndSetProgress(updated);
                                            }}
                                        />
                                        <span style={{ flex: 1, fontSize: '13px', textDecoration: t.isCompleted ? 'line-through' : 'none', color: t.isCompleted ? 'var(--text-tertiary)' : 'inherit' }}>{t.title}</span>
                                        <button onClick={() => removeSubTask(t.id)} style={{ border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer' }}>×</button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Attachments Section */}
                        <div className="input-group full-width" style={{ borderTop: '1px solid var(--border-primary)', paddingTop: '16px' }}>
                            <label>แนบไฟล์ประกอบ / ลิ้งค์งาน</label>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '8px', marginBottom: '12px' }}>
                                <input className="input" placeholder="ชื่อลิ้งค์/ชื่อไฟล์" value={linkInput.name} onChange={e => setLinkInput({...linkInput, name: e.target.value})} />
                                <input className="input" placeholder="URL (เช่น Google Drive, LINE)" value={linkInput.url} onChange={e => setLinkInput({...linkInput, url: e.target.value})} />
                                <button className="btn btn-secondary" onClick={handleAddLink}>+ เพิ่มลิ้งค์</button>
                            </div>
                            <div style={{ marginBottom: '12px' }}>
                                <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer' }}>
                                    <Upload size={14} /> แนบรูปภาพ หรือ PDF (สูงสุด 1MB)
                                    <input type="file" accept="image/*, .pdf" style={{ display: 'none' }} onChange={handleFileUpload} />
                                </label>
                            </div>

                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                {(form.attachments || []).map(a => (
                                    <div key={a.id} className="staff-chip" style={{ background: 'var(--bg-tertiary)', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ fontSize: '12px' }}>{a.type === 'link' ? '🔗' : '📄'} {a.name}</span>
                                        <button onClick={() => removeAttachment(a.id)} style={{ border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer' }}>×</button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>ยกเลิก</button>
                    <button className="btn btn-primary" onClick={() => onSave(form)}>
                        {job ? 'บันทึกการแก้ไข' : 'สร้างงานใหม่'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function JobDetailModal({ job, staff, onClose, onUpdate, onStatusChange }) {
    const statusClass = statusToKey(job.status);
    const [isAdding, setIsAdding] = useState(false);
    const [newLog, setNewLog] = useState('');
    const [logAttachments, setLogAttachments] = useState([]);
    const [logStaffIds, setLogStaffIds] = useState(job.assignedStaffIds || []); // New: Track staff for this specific log
    const [localIssues, setLocalIssues] = useState(job.currentIssues || '');

    // Sync local state when job prop changes
    useEffect(() => {
        setLocalIssues(job.currentIssues || '');
        setLogStaffIds(job.assignedStaffIds || []);
    }, [job.id, job.assignedStaffIds]); 

    const handleUpdateIssues = () => {
        saveJob({ ...job, currentIssues: localIssues });
        onUpdate();
    };

    const currentTeamIds = job.assignedStaffIds || [];
    const currentTeam = currentTeamIds.map(id => staff.find(s => s.id === id)).filter(Boolean);

    const availableStaff = staff.filter(s => !currentTeamIds.includes(s.id));

    const handleAddLog = async () => {
        if (!newLog.trim()) return;
        try {
            const { data, error } = await supabase.from('progress_logs').insert([{
                job_id: job.id,
                log_date: new Date().toISOString().split('T')[0],
                text: newLog,
                author: job.createdBy || 'Admin'
            }]).select();

            if (error) throw error;
            const logId = data[0].id;

            if (logStaffIds.length > 0) {
                const assignments = logStaffIds.map(sid => ({
                    log_id: logId,
                    staff_id: sid
                }));
                await supabase.from('log_staff_assignments').insert(assignments);
            }

            setNewLog('');
            setLogAttachments([]);
            if (onUpdate) onUpdate();
        } catch (error) {
            console.error('Error adding log:', error);
        }
    };

    const toggleWorkerInLog = (id) => {
        setLogStaffIds(prev => 
            prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]
        );
    };

    const handleLogFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            let fileUrl = '';
            const isImage = file.type.startsWith('image/');
            const isPdf = file.type.includes('pdf');

            if (isImage) {
                fileUrl = await compressImage(file);
            } else {
                if (file.size > 1024 * 1024) {
                    alert('ไฟล์ใหญ่เกินไป (จำกัด 1MB สำหรับ PDF)');
                    return;
                }
                const reader = new FileReader();
                fileUrl = await new Promise((resolve) => {
                    reader.onload = (ev) => resolve(ev.target.result);
                    reader.readAsDataURL(file);
                });
            }

            const { error } = await supabase.from('attachments').insert([{
                job_id: job.id,
                name: file.name,
                url: fileUrl,
                type: isPdf ? 'pdf' : 'image'
            }]);

            if (error) throw error;
            if (onUpdate) onUpdate();
        } catch (error) {
            console.error("Upload error:", error);
            alert('เกิดข้อผิดพลาดในการอัปโหลดไฟล์');
        }
    };

    const handleLogLinkAdd = async () => {
        const url = prompt('วาง URL ลิ้งค์งานหรือรูปภาพ:');
        if (!url) return;
        const name = prompt('ระบุชื่อเรียกโครงการ/ลิ้งค์:', 'ลิ้งค์แนบ');
        if (!name) return;
        
        try {
            const { error } = await supabase.from('attachments').insert([{
                job_id: job.id,
                name,
                url,
                type: 'link'
            }]);
            if (error) throw error;
            if (onUpdate) onUpdate();
        } catch (error) {
            console.error('Error adding link:', error);
        }
    };

    const removeLogAttachment = async (id) => {
        try {
            await supabase.from('attachments').delete().eq('id', id);
            if (onUpdate) onUpdate();
        } catch (error) {
            console.error('Error removing attachment:', error);
        }
    };

    const handleDeleteLog = async (logId) => {
        if (!confirm('ต้องการลบบันทึกนี้หรือไม่?')) return;
        try {
            const { error } = await supabase.from('progress_logs').delete().eq('id', logId);
            if (error) throw error;
            if (onUpdate) onUpdate();
        } catch (error) {
            console.error('Error deleting log:', error);
        }
    };

    const handleAddMember = async (staffId) => {
        if (!staffId) return;
        try {
            const { error } = await supabase.from('allocations').insert([{
                job_id: job.id,
                staff_id: staffId,
                date: new Date().toISOString().split('T')[0],
                status: 'ได้รับมอบหมาย'
            }]);
            if (error) throw error;
            onUpdate && onUpdate();
            setIsAdding(false);
        } catch (error) {
            console.error('Error adding member:', error);
        }
    };

    const handleRemoveMember = async (staffId) => {
        if (!confirm('ต้องการลบพนักงานออกจากทีมนี้?')) return;
        try {
            const { error } = await supabase.from('allocations')
                .delete()
                .eq('job_id', job.id)
                .eq('staff_id', staffId)
                .eq('date', new Date().toISOString().split('T')[0]);
            if (error) throw error;
            onUpdate && onUpdate();
        } catch (error) {
            console.error('Error removing member:', error);
        }
    };

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal" style={{ maxWidth: '700px' }}>
                <div className="modal-header">
                    <div>
                        <h2>{job.projectName}</h2>
                        <span style={{ fontSize: 'var(--font-sm)', color: 'var(--text-tertiary)' }}>
                            {job.qtNumber} • {job.clientName} 
                            {job.createdBy && <span style={{ color: 'var(--brand-primary)', marginLeft: '8px' }}>• ลงชื่อโดย: {job.createdBy}</span>}
                        </span>
                    </div>
                    <button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button>
                </div>
                <div className="modal-body">
                    <div className="detail-row">
                        <span className={`badge badge-${statusClass}`}>{job.status}</span>
                        <span className="job-type-tag">{job.jobType}</span>
                        <span style={{ color: getPriorityColor(job.priority), fontWeight: 600, fontSize: 'var(--font-sm)' }}>ความสำคัญ: {job.priority}</span>
                    </div>

                    {/* Progress & Issues Update Section */}
                    <div className="detail-section" style={{ background: 'var(--bg-tertiary)', padding: '20px', borderRadius: '12px' }}>
                        <div style={{ marginBottom: '20px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                <h4 style={{ margin: 0 }}>ความคืบหน้างาน: {job.overallProgress || 0}%</h4>
                                {job.overallProgress >= 100 && <span style={{ color: 'var(--status-completed)', fontWeight: 700, fontSize: '12px' }}>✓ เสร็จสมบูรณ์</span>}
                            </div>
                            
                            {/* Sub-tasks Checklist */}
                            {(job.subTasks || []).length > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {job.subTasks.map(t => (
                                        <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', background: '#fff', borderRadius: '8px', cursor: 'pointer', border: '1px solid #e5e7eb' }}>
                                            <input 
                                                type="checkbox" 
                                                checked={t.isCompleted} 
                                                onChange={(e) => {
                                                    const updatedTasks = job.subTasks.map(st => st.id === t.id ? {...st, isCompleted: e.target.checked} : st);
                                                    const completed = updatedTasks.filter(ut => ut.isCompleted).length;
                                                    const progress = Math.round((completed / updatedTasks.length) * 100);
                                                    saveJob({ 
                                                        ...job, 
                                                        subTasks: updatedTasks, 
                                                        overallProgress: progress,
                                                        status: progress === 100 ? 'เสร็จสมบูรณ์' : job.status
                                                    });
                                                    onUpdate();
                                                }}
                                            />
                                            <span style={{ fontSize: '14px', textDecoration: t.isCompleted ? 'line-through' : 'none', color: t.isCompleted ? 'var(--text-tertiary)' : 'inherit' }}>
                                                {t.title}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            ) : (
                                <div style={{ textAlign: 'center', padding: '10px', border: '1px dashed var(--border-primary)', borderRadius: '8px' }}>
                                    <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', margin: 0 }}>ไม่ได้กำหนดงานย่อย (สามารถเพิ่มได้ที่เมนู "แก้ไขงาน")</p>
                                    <input 
                                        type="range" min="0" max="100" step="5"
                                        value={job.overallProgress || 0}
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value);
                                            saveJob({ ...job, overallProgress: val, status: val === 100 ? 'เสร็จสมบูรณ์' : job.status });
                                            onUpdate();
                                        }}
                                        style={{ width: '100%', marginTop: '10px' }}
                                    />
                                </div>
                            )}
                        </div>

                        <div>
                            <h4 style={{ marginBottom: '8px' }}>ปัญหาที่พบ / สาเหตุที่ล่าช้า (ถ้ามี)</h4>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <input 
                                    className="input" 
                                    placeholder="เช่น ของไม่ครบ, หน้างานไม่พร้อม..."
                                    value={localIssues}
                                    onChange={(e) => setLocalIssues(e.target.value)}
                                    style={{ flex: 1, fontSize: '13px' }}
                                />
                                <button 
                                    className="btn btn-secondary btn-sm" 
                                    onClick={handleUpdateIssues}
                                    disabled={localIssues === (job.currentIssues || '')}
                                >
                                    อัปเดตปัญหา
                                </button>
                                {job.currentIssues && (
                                    <button className="btn btn-ghost btn-sm" onClick={() => { setLocalIssues(''); saveJob({...job, currentIssues: ''}); onUpdate(); }}>ล้าง</button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Status Selection */}
                    <div className="detail-section">
                        <h4>ปรับสถานะงาน</h4>
                        <div className="status-toggle" style={{ marginTop: '8px', borderTop: 'none', paddingTop: 0 }}>
                            {JOB_STATUSES.map(s => (
                                <button
                                    key={s}
                                    className={`toggle-btn toggle-${statusToKey(s)} ${job.status === s ? 'active' : ''}`}
                                    onClick={() => onStatusChange(job, s)}
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Team Management Section */}
                    <div className="detail-section">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <h4>ทีมงาน ({currentTeam.length})</h4>
                            <button className="btn btn-sm btn-outline" onClick={() => setIsAdding(!isAdding)}>
                                {isAdding ? 'ยกเลิก' : '+ เพิ่มทีมงาน'}
                            </button>
                        </div>

                        {isAdding && (
                            <div style={{ marginBottom: '12px', padding: '12px', background: '#f9fafb', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
                                <label style={{ display: 'block', marginBottom: '8px', fontSize: 'var(--font-sm)', fontWeight: 500 }}>เลือกพนักงานที่ต้องการเพิ่ม:</label>
                                <select
                                    className="select"
                                    onChange={(e) => handleAddMember(e.target.value)}
                                    defaultValue=""
                                    style={{ width: '100%' }}
                                >
                                    <option value="" disabled>-- เลือกพนักงาน --</option>
                                    {availableStaff.map(s => (
                                        <option key={s.id} value={s.id}>{s.nickname} ({s.fullName})</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {currentTeam.length > 0 ? (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                {currentTeam.map(s => (
                                    <div key={s.id} className="staff-chip" style={{ paddingRight: '4px' }}>
                                        {s.nickname}
                                        <button
                                            onClick={() => handleRemoveMember(s.id)}
                                            style={{
                                                border: 'none',
                                                background: 'transparent',
                                                cursor: 'pointer',
                                                marginLeft: '6px',
                                                color: '#ef4444',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                padding: '2px',
                                                borderRadius: '50%'
                                            }}
                                            title="ลบออก"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-sm)', fontStyle: 'italic' }}>
                                ยังไม่ได้ระบุทีมงาน (จะแสดงตามการมอบหมายงานรายวัน)
                            </p>
                        )}
                    </div>

                    <div className="detail-section">
                        <h4>ระยะเวลา</h4>
                        <p>{formatDate(job.startDate)} → {formatDate(job.endDate)}</p>
                    </div>
                    {job.notes && (
                        <div className="detail-section">
                            <h4>หมายเหตุ</h4>
                            <p>{job.notes}</p>
                        </div>
                    )}

                    {/* Attachments Display */}
                    {(job.attachments || []).length > 0 && (
                        <div className="detail-section">
                            <h4>ไฟล์ประกอบ / ลิ้งค์งาน</h4>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                {job.attachments.map(a => (
                                    <a 
                                        key={a.id} 
                                        href={a.url} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="btn btn-sm btn-secondary"
                                        style={{ textDecoration: 'none' }}
                                    >
                                        {a.type === 'link' ? '🔗' : '📄'} {a.name}
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Progress Logs Section */}
                    <div className="detail-section" style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                        <h4 style={{ marginBottom: '12px' }}>บันทึกความคืบหน้างาน</h4>
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
                            {/* Worker Selection for this log */}
                            <div style={{ background: '#fff', padding: '10px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: '8px', textTransform: 'uppercase' }}>คนทำงานวันนี้:</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                    {staff.map(s => (
                                        <button 
                                            key={s.id}
                                            onClick={() => toggleWorkerInLog(s.id)}
                                            style={{ 
                                                border: 'none', 
                                                padding: '2px 10px', 
                                                borderRadius: '12px', 
                                                fontSize: '11px', 
                                                cursor: 'pointer',
                                                background: logStaffIds.includes(s.id) ? 'var(--brand-primary)' : 'var(--bg-tertiary)',
                                                color: logStaffIds.includes(s.id) ? '#fff' : 'inherit',
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            {s.nickname}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '8px' }}>
                                <textarea 
                                    className="input" 
                                    style={{ flex: 1, minHeight: '60px', fontSize: 'var(--font-sm)' }}
                                    placeholder="พิมพ์อัปเดตสถานการณ์วันนี้..."
                                    value={newLog}
                                    onChange={e => setNewLog(e.target.value)}
                                />
                                <button 
                                    className="btn btn-primary" 
                                    style={{ height: 'fit-content' }}
                                    onClick={handleAddLog}
                                >
                                    บันทึก
                                </button>
                            </div>

                            {/* Log Attachment Controls */}
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <button className="btn btn-ghost btn-sm" onClick={handleLogLinkAdd} style={{ fontSize: '11px' }}>
                                    🔗 แนบลิ้งค์
                                </button>
                                <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer', fontSize: '11px' }}>
                                    📄 แนบไฟล์/รูป
                                    <input type="file" style={{ display: 'none' }} accept="image/*, .pdf" onChange={handleLogFileUpload} />
                                </label>
                                
                                {logAttachments.length > 0 && (
                                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginLeft: '8px' }}>
                                        {logAttachments.map(a => (
                                            <div key={a.id} style={{ fontSize: '10px', background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                {a.name}
                                                <span onClick={() => removeLogAttachment(a.id)} style={{ cursor: 'pointer', color: '#ef4444' }}>×</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '400px', overflowY: 'auto', paddingRight: '4px' }}>
                            {(job.progressLogs || []).length > 0 ? (
                                job.progressLogs.map(log => (
                                    <div key={log.id} style={{ padding: '12px', background: '#fff', borderRadius: '8px', border: '1px solid #f1f5f9', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--brand-primary)' }}>{formatDate(log.date)}</span>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>โดย: {log.author}</span>
                                                <button 
                                                    onClick={() => handleDeleteLog(log.id)}
                                                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#cbd5e1', padding: '0 2px', fontSize: '14px' }}
                                                    title="ลบบันทึก"
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        </div>
                                        <p style={{ fontSize: 'var(--font-sm)', margin: '0 0 10px 0', lineHeight: '1.5' }}>{log.text}</p>

                                        {/* Workers for this log */}
                                        {log.workerIds?.length > 0 && (
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '10px', padding: '6px', background: '#f8fafc', borderRadius: '6px' }}>
                                                <span style={{ fontSize: '10px', fontWeight: 700, color: '#64748b' }}>ผู้ร่วมงาน:</span>
                                                {log.workerIds.map(wid => (
                                                    <span key={wid} style={{ fontSize: '10px', color: '#334155' }}>
                                                        {staff.find(s => s.id === wid)?.nickname || 'ช่าง'}
                                                    </span>
                                                )).reduce((prev, curr) => [prev, ', ', curr])}
                                            </div>
                                        )}

                                        {/* Display log-specific attachments */}
                                        {log.attachments?.length > 0 && (
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                                {log.attachments.map(a => (
                                                    <a 
                                                        key={a.id} 
                                                        href={a.url} 
                                                        target="_blank" 
                                                        rel="noopener noreferrer"
                                                        style={{ 
                                                            fontSize: '10px', 
                                                            padding: '2px 8px', 
                                                            background: '#f1f5f9', 
                                                            borderRadius: '4px', 
                                                            color: 'var(--brand-primary)',
                                                            textDecoration: 'none',
                                                            border: '1px solid #e2e8f0',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '4px'
                                                        }}
                                                    >
                                                        {a.type === 'link' ? '🔗' : '📄'} {a.name}
                                                    </a>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))
                            ) : (
                                <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-tertiary)', textAlign: 'center', fontStyle: 'italic' }}>ยังไม่มีบันทึกความคืบหน้า</p>
                            )}
                        </div>
                    </div>

                    {job.fixReason && (
                        <div className="detail-section fix-section">
                            <h4><AlertCircle size={14} /> Fix Required</h4>
                            <p>{job.fixReason}</p>
                        </div>
                    )}
                </div>
                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>ปิด</button>
                </div>
            </div>
        </div>
    );
}
