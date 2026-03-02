import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, User, X, Clock, MapPin, Briefcase, FileText, Printer, Eye, Edit3, Trash2, Loader2, AlertCircle, Upload } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { getJobs, saveJob, getStaff, getAllocations, saveAllocation, deleteAllocation, getAllocationsByJob, deleteJob } from '../data/store';
import { createAllocation, JOB_STATUSES, JOB_TYPES, PRIORITIES, createJob } from '../data/models';
import { getWeekDates, getMonthDates, formatDate, formatDateShort, formatDay, formatMonthYear, getTodayStr, statusToKey, jobTypeToKey, getPriorityColor, getRoleColor, compressImage } from '../utils/helpers';
import { addDays, addMonths, startOfMonth } from 'date-fns';
import './Scheduler.css';

export default function Scheduler() {
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
    const today = getTodayStr();

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            // Fetch Staff
            const { data: staffData, error: staffError } = await supabase.from('staff').select('*');
            if (staffError) throw staffError;

            const formattedStaff = (staffData || []).map(s => ({
                id: s.id,
                nickname: s.nickname || 'ช่าง',
                fullName: s.full_name || '',
                role: s.role || 'พนักงาน',
                isActive: s.is_active ?? true
            }));
            setStaff(formattedStaff);

            // Fetch Allocations first to map members to jobs
            const { data: allocData, error: allocError } = await supabase.from('allocations').select('*');
            if (allocError) throw allocError;
            setAllocations(allocData || []);

            // Fetch Jobs
            const { data: jobsData, error: jobsError } = await supabase.from('jobs').select(`
                *,
                sub_tasks (*),
                attachments (*),
                progress_logs (*, log_staff_assignments(staff_id))
            `);
            if (jobsError) throw jobsError;

            if (jobsData) {
                const formatted = jobsData.map(j => {
                    const jobAllocs = (allocData || []).filter(a => a.job_id === j.id);
                    const uniqueStaffIds = [...new Set(jobAllocs.map(a => a.staff_id))];

                    return {
                        id: j.id,
                        qtNumber: j.qt_number || '',
                        projectName: j.project_name || 'ไม่มีชื่อโปรเจกต์',
                        clientName: j.client_name || '',
                        jobType: j.job_type || 'อื่นๆ',
                        status: j.status || 'รอคิว',
                        startDate: j.start_date || today,
                        endDate: j.end_date || j.start_date || today,
                        defaultCheckIn: j.default_check_in || '09:00',
                        defaultCheckOut: j.default_check_out || '18:00',
                        priority: j.priority || 'ปกติ',
                        fixReason: j.fix_reason || '',
                        notes: j.notes || '',
                        createdBy: j.created_by || '',
                        overallProgress: j.overall_progress || 0,
                        currentIssues: j.current_issues || '',
                        subTasks: (j.sub_tasks || []).map(st => ({ id: st.id, title: st.title || '', isCompleted: st.is_completed })),
                        attachments: (j.attachments || []).map(a => ({ id: a.id, name: a.name || 'ไฟล์', url: a.url || '#', type: a.type || 'image' })),
                        progressLogs: (j.progress_logs || []).map(pl => ({
                            id: pl.id,
                            date: pl.log_date || today,
                            text: pl.text || '',
                            author: pl.author || '',
                            workerIds: (pl.log_staff_assignments || []).map(lsa => lsa.staff_id)
                        })),
                        assignedStaffIds: uniqueStaffIds
                    };
                });
                setJobs(formatted);
            }
        } catch (error) {
            console.error('CRITICAL ERROR in Scheduler fetchData:', error);
            alert('เกิดข้อผิดพลาดในการโหลดข้อมูล: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleSaveJob = async (job) => {
        // Shared save logic (reusing simplified version from Jobs.jsx)
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

            // Save Sub-tasks
            await supabase.from('sub_tasks').delete().eq('job_id', jobId);
            if (job.subTasks?.length > 0) {
                const subTasksData = job.subTasks.map(st => ({
                    job_id: jobId,
                    title: st.title,
                    is_completed: st.isCompleted
                }));
                await supabase.from('sub_tasks').insert(subTasksData);
            }

            // Save Attachments
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

            await fetchData();
            setShowEditJobModal(false);
            setEditingJob(null);
            // If we're editing the currently selected job, update its detail view too
            if (selectedJob && selectedJob.id === jobId) {
                // We need to find the fresh job data from the state after refresh
                // But fetchData is async and updates state, so we might need a more direct way or useEffect
            }
        } catch (error) {
            console.error('Error saving job:', error);
            alert('ไม่สามารถบันทึกข้อมูลได้');
        }
    };

    // Effect to keep selectedJob in sync with jobs array
    useEffect(() => {
        if (selectedJob) {
            const updated = jobs.find(j => j.id === selectedJob.id);
            if (updated) {
                // Only update if something actually changed to avoid infinite loops
                if (JSON.stringify(updated) !== JSON.stringify(selectedJob)) {
                    setSelectedJob(updated);
                }
            }
        }
    }, [jobs, selectedJob]);

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
            fetchData();
            
            if (selectedJob && selectedJob.id === job.id) {
                setSelectedJob({ ...job, status: newStatus, fixReason });
            }
        } catch (error) {
            console.error('Error updating status:', error);
        }
    };

    const handleDeleteJob = async (id) => {
        if (confirm('ยืนยันการลบงานนี้?')) {
            const { error } = await supabase.from('jobs').delete().eq('id', id);
            if (error) alert('Error');
            else {
                fetchData();
                setSelectedJob(null);
            }
        }
    };

    const refresh = fetchData;

    const baseDate = useMemo(() => addDays(new Date(), weekOffset * 7), [weekOffset]);
    const weekDates = useMemo(() => {
        try {
            return getWeekDates(baseDate) || [];
        } catch (e) {
            console.error(e);
            return [];
        }
    }, [baseDate]);

    const baseMonthDate = useMemo(() => addMonths(startOfMonth(new Date()), monthOffset), [monthOffset]);
    const monthDates = useMemo(() => {
        try {
            return getMonthDates(baseMonthDate) || [];
        } catch (e) {
            console.error(e);
            return [];
        }
    }, [baseMonthDate]);

    const isJobHighlighted = (jobId, dateStr) => {
        if (!selectedStaffId) return true;
        const job = jobs?.find(j => j.id === jobId);
        return job?.assignedStaffIds?.includes(selectedStaffId);
    };

    const getJobsForDate = (dateStr) => {
        return (jobs || []).filter(j =>
            j.status !== 'เสร็จสมบูรณ์' &&
            j.startDate <= dateStr &&
            j.endDate >= dateStr
        );
    };

    if (loading) {
        return (
            <div className="page-content" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                <Loader2 className="animate-spin" size={48} />
            </div>
        );
    }

    return (
        <div className="page-content">
            <div className="page-header">
                <div>
                    <h1>ตารางงาน</h1>
                    <p className="subtitle">กดเลือกงานที่ต้องการดู/แก้ไขรายละเอียดพนักงาน</p>
                </div>
                <div className="scheduler-controls">
                    <div className="staff-filter-dropdown" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: 'var(--space-4)' }}>
                        <User size={18} style={{ color: 'var(--text-tertiary)' }} />
                        <select
                            className="select"
                            style={{ minWidth: '200px', fontSize: '14px' }}
                            value={selectedStaffId || ''}
                            onChange={e => setSelectedStaffId(e.target.value || null)}
                        >
                            <option value="">เลือกพนักงานเพื่อกรองงาน...</option>
                            {(staff || []).filter(s => s.isActive).sort((a, b) => (a.nickname || '').localeCompare(b.nickname || '')).map(s => (
                                <option key={s.id} value={s.id}>{s.nickname} ({s.role})</option>
                            ))}
                        </select>
                        {selectedStaffId && (
                            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setSelectedStaffId(null)} title="ล้างตัวกรอง">
                                <X size={16} />
                            </button>
                        )}
                    </div>
                    <div className="view-toggle">
                        <button className={`btn btn-sm ${viewMode === 'week' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setViewMode('week')}>รายสัปดาห์</button>
                        <button className={`btn btn-sm ${viewMode === 'month' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setViewMode('month')}>รายเดือน</button>
                    </div>
                    <div className="week-nav">
                        <button className="btn btn-secondary btn-icon" onClick={() => viewMode === 'week' ? setWeekOffset(w => w - 1) : setMonthOffset(m => m - 1)}>
                            <ChevronLeft size={18} />
                        </button>
                        <span className="current-period-label" style={{ fontWeight: 600, minWidth: '120px', textAlign: 'center' }}>
                            {viewMode === 'week' ? 'สัปดาห์นี้' : formatMonthYear(baseMonthDate.toISOString())}
                        </span>
                        <button className="btn btn-secondary btn-sm" onClick={() => { setWeekOffset(0); setMonthOffset(0); }}>
                            ปัจจุบัน
                        </button>
                        <button className="btn btn-secondary btn-icon" onClick={() => viewMode === 'week' ? setWeekOffset(w => w + 1) : setMonthOffset(m => m + 1)}>
                            <ChevronRight size={18} />
                        </button>
                    </div>
                </div>
            </div>

            {viewMode === 'week' ? (
                <div className="scheduler-grid">
                    {weekDates.map(dateStr => {
                        const isToday = dateStr === today;
                        const dayJobs = getJobsForDate(dateStr);

                        return (
                            <div
                                key={dateStr}
                                className={`scheduler-day ${isToday ? 'today' : ''}`}
                            >
                                <div className="day-header">
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                        <span className="day-name">{formatDay(dateStr)}</span>
                                        <button
                                            className="btn btn-primary btn-icon"
                                            style={{ width: '38px', height: '38px', borderRadius: '8px' }}
                                            title="สรุปรายงานประจำวัน"
                                            onClick={() => { setReportDate(dateStr); setShowReportModal(true); }}
                                        >
                                            <FileText size={20} />
                                        </button>
                                    </div>
                                    <span className={`day-date ${isToday ? 'today-badge' : ''}`}>
                                        {formatDateShort(dateStr)}
                                    </span>
                                </div>
                                <div className="day-summary">
                                    <div className="ds-item" title="จำนวนงาน">
                                        <Briefcase size={10} /> {dayJobs?.length || 0}
                                    </div>
                                    <div className="ds-item" title="จำนวนพนักงาน">
                                        <User size={10} /> {(() => {
                                            const allStaffIds = new Set();
                                            dayJobs?.forEach(j => {
                                                (j?.assignedStaffIds || []).forEach(id => allStaffIds.add(id));
                                            });
                                            return allStaffIds.size;
                                        })()}
                                    </div>
                                </div>
                                <div className="day-content">
                                    {dayJobs?.map((job) => {
                                        const assignedStaffIds = job?.assignedStaffIds || [];
                                        const jobTeam = assignedStaffIds.map(id => staff?.find(s => s.id === id)).filter(Boolean);
                                        const typeClass = jobTypeToKey(job?.jobType || 'อื่นๆ');
                                        const statusClass = statusToKey(job?.status || 'รอคิว');
                                        const highlighted = isJobHighlighted(job?.id, dateStr);

                                        return (
                                            <div
                                                key={`${job?.id}-${dateStr}`}
                                                className={`scheduler-job-card type-${typeClass} clickable ${selectedStaffId ? (highlighted ? 'job-highlighted' : 'job-dimmed') : ''}`}
                                                onClick={() => setSelectedJob(job)}
                                                style={{ cursor: 'pointer' }}
                                            >
                                                <div className="sj-header">
                                                    <span className="sj-name">{job?.projectName || 'ไม่มีชื่อโปรเจกต์'}</span>
                                                </div>
                                                
                                                {/* Progress Mini Bar */}
                                                <div className="sj-progress" style={{ margin: '4px 0' }}>
                                                    <div style={{ height: '3px', background: 'rgba(0,0,0,0.05)', borderRadius: '2px', overflow: 'hidden' }}>
                                                        <div style={{ 
                                                            height: '100%', 
                                                            width: `${job?.overallProgress || 0}%`, 
                                                            background: (job?.overallProgress || 0) >= 100 ? 'var(--status-completed)' : 'var(--brand-primary)',
                                                            transition: 'width 0.3s ease'
                                                        }}></div>
                                                    </div>
                                                </div>

                                                {job?.currentIssues && (
                                                    <div style={{ fontSize: '9px', color: 'var(--status-needs-fix)', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '2px' }}>
                                                        <AlertCircle size={8} /> ติดปัญหา
                                                    </div>
                                                )}

                                                <div className="sj-meta">
                                                    <span className={`badge badge-${statusClass}`} style={{ fontSize: '9px', padding: '1px 6px' }}>
                                                        {job?.status || 'รอคิว'}
                                                    </span>
                                                    <span className="sj-type">{job?.jobType || 'อื่นๆ'}</span>
                                                    <div className="sj-time-range" title="เวลาทำงานหลัก">
                                                        <Clock size={10} />
                                                        {job?.defaultCheckIn || '09:00'} - {job?.defaultCheckOut || '18:00'}
                                                    </div>
                                                </div>
                                                <div className="sj-staff">
                                                    {jobTeam?.map(s => (
                                                        <div
                                                            key={s?.id}
                                                            className="sj-staff-chip"
                                                            style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                                                        >
                                                            <span>{s?.nickname || 'ช่าง'}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {(dayJobs?.length === 0) && (
                                        <div className="day-empty">ไม่มีงาน</div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="scheduler-month-grid">
                    {['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'].map(day => (
                        <div key={day} className="month-day-header">{day}</div>
                    ))}
                    {monthDates.map(dateStr => {
                        const isToday = dateStr === today;
                        const dayJobs = getJobsForDate(dateStr);
                        const allStaffIds = new Set();
                        dayJobs.forEach(j => {
                            (j.assignedStaffIds || []).forEach(id => allStaffIds.add(id));
                        });
                        const uniqueStaffCount = allStaffIds.size;
                        const isCurrentMonth = dateStr.startsWith(baseMonthDate.toISOString().substring(0, 7));

                        return (
                            <div key={dateStr} className={`month-cell ${isToday ? 'today' : ''} ${!isCurrentMonth ? 'other-month' : ''}`}>
                                <div className="month-cell-header">
                                    <span className={`month-date ${isToday ? 'today-badge' : ''}`}>{parseInt(dateStr.split('-')[2], 10)}</span>
                                </div>
                                <div className="month-cell-content">
                                    {dayJobs.length > 0 ? (
                                        <div className="month-badge job-count-badge">
                                            {dayJobs.length} โปรเจกต์
                                        </div>
                                    ) : null}
                                    {uniqueStaffCount > 0 ? (
                                        <div className="month-badge staff-count-badge">
                                            <User size={10} /> {uniqueStaffCount} คน
                                        </div>
                                    ) : null}
                                </div>
                                <button
                                    className="month-cell-action"
                                    onClick={() => setViewMode('week')}
                                    title="ดูรายละเอียดรายสัปดาห์"
                                >
                                    ดูรายละเอียด
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            {showReportModal && reportDate && (
                <DailyReportModal
                    date={reportDate}
                    jobs={jobs}
                    staff={staff}
                    onClose={() => setShowReportModal(false)}
                />
            )}

            {selectedJob && (
                <JobDetailModal
                    job={selectedJob}
                    staff={staff}
                    onClose={() => setSelectedJob(null)}
                    onEdit={() => setShowEditJobModal(true)}
                    onDelete={() => handleDeleteJob(selectedJob.id)}
                    onStatusChange={handleStatusChange}
                    onUpdate={async () => {
                        await fetchData();
                        // fetchData updates 'jobs' state, and the useEffect will sync selectedJob
                    }}
                />
            )}

            {showEditJobModal && selectedJob && (
                <JobModal
                    job={selectedJob}
                    staff={staff}
                    onSave={handleSaveJob}
                    onClose={() => setShowEditJobModal(false)}
                />
            )}
        </div>
    );
}

function JobModal({ job, staff, onSave, onClose }) {
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
            <div className="modal">
                <div className="modal-header">
                    <h2>{job ? 'แก้ไขงาน' : 'เพิ่มงานใหม่'}</h2>
                    <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={18} /></button>
                </div>
                <div className="modal-body">
                    <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div className="input-group">
                            <label>เลขที่ QT</label>
                            <input className="input" value={form.qtNumber} onChange={e => update('qtNumber', e.target.value)} />
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
                                        if (val !== 'อื่นๆ') {
                                            update('createdBy', val);
                                        }
                                    }}
                                >
                                    <option value="">-- เลือกผู้รับผิดชอบ --</option>
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
                            <label>ชื่อโปรเจกต์</label>
                            <input className="input" value={form.projectName} onChange={e => update('projectName', e.target.value)} />
                        </div>
                        <div className="input-group">
                            <label>ชื่อลูกค้า</label>
                            <input className="input" value={form.clientName} onChange={e => update('clientName', e.target.value)} />
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
                        <div className="input-group">
                            <label>ความสำคัญ</label>
                            <select className="select" value={form.priority} onChange={e => update('priority', e.target.value)}>
                                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
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
                                <label><Clock size={14} /> เข้า (ดีฟอลต์)</label>
                                <input className="input" type="time" value={form.defaultCheckIn} onChange={e => update('defaultCheckIn', e.target.value)} />
                            </div>
                            <div className="input-group">
                                <label><Clock size={14} /> ออก (ดีฟอลต์)</label>
                                <input className="input" type="time" value={form.defaultCheckOut} onChange={e => update('defaultCheckOut', e.target.value)} />
                            </div>
                        </div>
                        <div className="input-group full-width">
                            <label>หมายเหตุ</label>
                            <textarea className="textarea" value={form.notes} onChange={e => update('notes', e.target.value)} />
                        </div>

                        {/* Permanent Team Selection */}
                        <div className="input-group full-width" style={{ borderTop: '1px solid var(--border-primary)', paddingTop: '16px' }}>
                            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span>ทีมงานประจำโปรเจกต์</span>
                                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>เลือกทีมงานที่ดูแลโปรเจกต์นี้หลักๆ</span>
                            </label>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                                {staff.map(s => {
                                    const isSelected = (form.assignedStaffIds || []).includes(s.id);
                                    return (
                                        <button
                                            key={s.id}
                                            type="button"
                                            onClick={() => {
                                                const currentIds = form.assignedStaffIds || [];
                                                if (currentIds.includes(s.id)) {
                                                    update('assignedStaffIds', currentIds.filter(id => id !== s.id));
                                                } else {
                                                    update('assignedStaffIds', [...currentIds, s.id]);
                                                }
                                            }}
                                            style={{
                                                padding: '4px 12px',
                                                borderRadius: '20px',
                                                border: '1px solid',
                                                borderColor: isSelected ? 'var(--brand-primary)' : 'var(--border-primary)',
                                                background: isSelected ? 'var(--brand-primary)' : 'transparent',
                                                color: isSelected ? '#fff' : 'var(--text-primary)',
                                                fontSize: '12px',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            {s.nickname}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Sub-tasks Section */}
                        <div className="input-group full-width" style={{ borderTop: '1px solid var(--border-primary)', paddingTop: '16px' }}>
                            <label>รายการงานย่อย</label>
                            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                                <input 
                                    className="input" 
                                    placeholder="เช่น ติดตั้งโต๊ะ 10 ชุด..." 
                                    value={subTaskInput}
                                    onChange={e => setSubTaskInput(e.target.value)}
                                    onKeyPress={e => e.key === 'Enter' && (e.preventDefault(), handleAddSubTask())}
                                />
                                <button className="btn btn-secondary" onClick={handleAddSubTask}>เพิ่ม</button>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {(form.subTasks || []).map(t => (
                                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: 'var(--bg-tertiary)', borderRadius: '4px' }}>
                                        <input 
                                            type="checkbox" 
                                            checked={t.isCompleted} 
                                            onChange={(e) => {
                                                const updated = form.subTasks.map(st => st.id === t.id ? {...st, isCompleted: e.target.checked} : st);
                                                calculateAndSetProgress(updated);
                                            }}
                                        />
                                        <span style={{ flex: 1, fontSize: '12px', textDecoration: t.isCompleted ? 'line-through' : 'none' }}>{t.title}</span>
                                        <button onClick={() => removeSubTask(t.id)} style={{ border: 'none', background: 'transparent', color: '#ef4444' }}>×</button>
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
                                <button className="btn btn-secondary" onClick={handleAddLink}>+ เพิ่ม</button>
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
                    <button className="btn btn-primary" onClick={() => onSave(form)}>บันทึก</button>
                </div>
            </div>
        </div>
    );
}

function JobDetailModal({ job, staff, user, onClose, onEdit, onDelete, onUpdate, onStatusChange }) {
    const statusClass = statusToKey(job.status);
    const [isAdding, setIsAdding] = useState(false);
    const [newLog, setNewLog] = useState('');
    const [logAttachments, setLogAttachments] = useState([]);
    const [logStaffIds, setLogStaffIds] = useState(job.assignedStaffIds || []);
    const [localIssues, setLocalIssues] = useState(job.currentIssues || '');

    useEffect(() => {
        setLocalIssues(job.currentIssues || '');
        setLogStaffIds(job.assignedStaffIds || []);
    }, [job.id, job.assignedStaffIds]);

    const handleUpdateIssues = async () => {
        try {
            await supabase.from('jobs').update({ current_issues: localIssues }).eq('id', job.id);
            onUpdate();
        } catch (error) {
            console.error(error);
        }
    };

    const currentTeamIds = job.assignedStaffIds || [];
    const currentTeam = currentTeamIds.map(id => staff.find(s => s.id === id)).filter(Boolean);
    const availableStaff = staff.filter(s => !currentTeamIds.includes(s.id));

    const handleAddLog = async () => {
        if (!newLog.trim()) return;
        
        // Auto-identify author from session metadata or email
        const authorName = user?.user_metadata?.nickname || user?.email?.split('@')[0] || 'Admin';

        try {
            const { data, error } = await supabase.from('progress_logs').insert([{
                job_id: job.id,
                log_date: new Date().toISOString().split('T')[0],
                text: newLog,
                author: authorName
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
        }
    };

    const handleLogLinkAdd = async () => {
        const url = prompt('วาง URL ลิ้งค์งานหรือรูปภาพ:');
        if (!url) return;
        const name = prompt('ระบุชื่อเรียกโครงการ/ลิ้งค์:', 'ลิ้งค์แนบ');
        if (!name) return;
        
        try {
            await supabase.from('attachments').insert([{
                job_id: job.id,
                name,
                url,
                type: 'link'
            }]);
            if (onUpdate) onUpdate();
        } catch (error) {
            console.error(error);
        }
    };

    const removeLogAttachment = async (id) => {
        try {
            await supabase.from('attachments').delete().eq('id', id);
            if (onUpdate) onUpdate();
        } catch (error) {
            console.error(error);
        }
    };

    const handleDeleteLog = async (logId) => {
        if (!confirm('ต้องการลบบันทึกนี้หรือไม่?')) return;
        try {
            await supabase.from('progress_logs').delete().eq('id', logId);
            if (onUpdate) onUpdate();
        } catch (error) {
            console.error(error);
        }
    };

    const handleAddMember = async (staffId) => {
        if (!staffId) return;
        try {
            await supabase.from('allocations').insert([{
                job_id: job.id,
                staff_id: staffId,
                date: new Date().toISOString().split('T')[0],
                status: 'ได้รับมอบหมาย'
            }]);
            onUpdate && onUpdate();
            setIsAdding(false);
        } catch (error) {
            console.error(error);
        }
    };

    const handleRemoveMember = async (staffId) => {
        if (!confirm('ต้องการลบพนักงานออกจากทีมนี้?')) return;
        try {
            await supabase.from('allocations')
                .delete()
                .eq('job_id', job.id)
                .eq('staff_id', staffId)
                .eq('date', new Date().toISOString().split('T')[0]);
            onUpdate && onUpdate();
        } catch (error) {
            console.error(error);
        }
    };

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal" style={{ maxWidth: '700px' }}>
                <div className="modal-header">
                    <div>
                        <h2 style={{ fontSize: '18px' }}>{job.projectName}</h2>
                        <p style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>
                            {job.qtNumber} • {job.clientName}
                            {job.createdBy && <span style={{ color: 'var(--brand-primary)', marginLeft: '8px' }}>• ลงชื่อโดย: {job.createdBy}</span>}
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                        <button className="btn btn-ghost btn-icon" onClick={onEdit} title="แก้ไขงาน"><Edit3 size={18} /></button>
                        <button className="btn btn-ghost btn-icon" onClick={onDelete} title="ลบงาน" style={{ color: 'var(--status-needs-fix)' }}><Trash2 size={18} /></button>
                        <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={18} /></button>
                    </div>
                </div>
                <div className="modal-body">
                    <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
                        <span className={`badge badge-${statusClass}`}>{job.status}</span>
                        <span className="badge badge-outline">{job.jobType}</span>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: getPriorityColor(job.priority) }}>ความสำคัญ: {job.priority}</span>
                    </div>

                    {/* Progress & Issues Section */}
                    <div style={{ background: 'var(--bg-tertiary)', padding: '16px', borderRadius: '12px', marginBottom: '24px' }}>
                        <div style={{ marginBottom: '16px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                                <h4 style={{ fontSize: '13px' }}>ความคืบหน้างาน: {job.overallProgress || 0}%</h4>
                                {job.overallProgress >= 100 && <span style={{ color: 'var(--status-completed)', fontWeight: 700, fontSize: '11px' }}>✓ เสร็จสมบูรณ์</span>}
                            </div>
                            
                            {/* Sub-tasks Checklist */}
                            {(job.subTasks || []).length > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    {job.subTasks.map(t => (
                                        <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: '#fff', borderRadius: '8px', cursor: 'pointer', border: '1px solid #e5e7eb' }}>
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
                                            <span style={{ fontSize: '13px', textDecoration: t.isCompleted ? 'line-through' : 'none', color: t.isCompleted ? 'var(--text-tertiary)' : 'inherit' }}>
                                                {t.title}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            ) : (
                                <div style={{ textAlign: 'center', padding: '10px', border: '1px dashed var(--border-primary)', borderRadius: '8px' }}>
                                    <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: 0 }}>ไม่ได้กำหนดงานย่อย</p>
                                    <input 
                                        type="range" min="0" max="100" step="5"
                                        value={job.overallProgress || 0}
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value);
                                            saveJob({ ...job, overallProgress: val, status: val === 100 ? 'เสร็จสมบูรณ์' : job.status });
                                            onUpdate();
                                        }}
                                        style={{ width: '100%', marginTop: '8px' }}
                                    />
                                </div>
                            )}
                        </div>
                        <div>
                            <h4 style={{ fontSize: '13px', marginBottom: '6px' }}>ปัญหาที่พบ / สาเหตุที่ล่าช้า</h4>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <input 
                                    className="input" placeholder="ระบุปัญหาติดขัด..."
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
                            </div>
                        </div>
                    </div>

                    {/* Status Selection */}
                    <div style={{ marginBottom: '24px' }}>
                        <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>ปรับสถานะงาน</h4>
                        <div className="status-toggle" style={{ marginTop: '8px', borderTop: 'none', paddingTop: 0, display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                            {JOB_STATUSES.map(s => (
                                <button
                                    key={s}
                                    className={`toggle-btn toggle-${statusToKey(s)} ${job.status === s ? 'active' : ''}`}
                                    onClick={() => onStatusChange(job, s)}
                                    style={{ padding: '4px 12px', fontSize: '12px' }}
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div style={{ marginBottom: '20px' }}>
                        <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>ระยะเวลาโปรเจกต์</h4>
                        <p style={{ fontSize: '14px' }}>{formatDate(job.startDate)} ถึง {formatDate(job.endDate)}</p>
                    </div>

                    {job.notes && (
                        <div style={{ marginBottom: '20px' }}>
                            <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>หมายเหตุ / รายละเอียด</h4>
                            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', background: 'var(--bg-tertiary)', padding: '10px', borderRadius: '6px' }}>{job.notes}</p>
                        </div>
                    )}

                    {/* Attachments Display */}
                    {(job.attachments || []).length > 0 && (
                        <div style={{ marginBottom: '20px' }}>
                            <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>ไฟล์ประกอบ / ลิ้งค์งาน</h4>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                {job.attachments.map(a => (
                                    <a 
                                        key={a.id} 
                                        href={a.url} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="btn btn-sm btn-secondary"
                                        style={{ textDecoration: 'none', fontSize: '12px' }}
                                    >
                                        {a.type === 'link' ? '🔗' : '📄'} {a.name}
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Progress Logs Section */}
                    <div style={{ marginBottom: '24px', padding: '16px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                        <h4 style={{ fontSize: '14px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <FileText size={16} /> บันทึกความคืบหน้างาน
                        </h4>
                        
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
                                    style={{ flex: 1, minHeight: '60px', fontSize: '13px' }}
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

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '350px', overflowY: 'auto', paddingRight: '4px' }}>
                            {(job.progressLogs || []).length > 0 ? (
                                job.progressLogs.map(log => (
                                    <div key={log.id} style={{ padding: '12px', background: '#fff', borderRadius: '8px', border: '1px solid #f1f5f9', boxShadow: '0 1px 2px rgba(0,0,0,0.02)', position: 'relative' }}>
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
                                        <p style={{ fontSize: '13px', margin: '0 0 10px 0', color: 'var(--text-primary)', lineHeight: '1.5' }}>{log.text}</p>
                                        
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
                                <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', textAlign: 'center', fontStyle: 'italic', margin: '10px 0' }}>ยังไม่มีบันทึกความคืบหน้า</p>
                            )}
                        </div>
                    </div>

                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <h4 style={{ fontSize: '14px' }}>ทีมงานประจำโปรเจกต์ ({currentTeam.length})</h4>
                            <button className="btn btn-sm btn-outline" onClick={() => setIsAdding(!isAdding)} style={{ fontSize: '11px' }}>
                                {isAdding ? 'ยกเลิก' : '+ เพิ่มทีมงาน'}
                            </button>
                        </div>

                        {isAdding && (
                            <div style={{ marginBottom: '12px', padding: '12px', background: 'var(--bg-tertiary)', borderRadius: '6px', border: '1px solid var(--border-primary)' }}>
                                <select
                                    className="select"
                                    onChange={(e) => handleAddMember(e.target.value)}
                                    defaultValue=""
                                    style={{ width: '100%', fontSize: '13px' }}
                                >
                                    <option value="" disabled>-- เลือกพนักงานเพื่อเพิ่มเข้าทีม --</option>
                                    {availableStaff.map(s => (
                                        <option key={s.id} value={s.id}>{s.nickname} ({s.fullName})</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {currentTeam.length > 0 ? (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                {currentTeam.map(s => (
                                    <div key={s.id} className="staff-chip" style={{ 
                                        padding: '4px 8px 4px 12px', 
                                        background: 'var(--bg-tertiary)', 
                                        borderRadius: '20px', 
                                        fontSize: '13px',
                                        fontWeight: 500,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px'
                                    }}>
                                        {s.nickname}
                                        <button 
                                            onClick={() => handleRemoveMember(s.id)}
                                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--status-needs-fix)', display: 'flex', padding: '2px' }}
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p style={{ color: 'var(--text-tertiary)', fontSize: '13px', fontStyle: 'italic' }}>ยังไม่ได้ระบุทีมงาน</p>
                        )}
                    </div>
                </div>
                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>ปิดหน้าต่าง</button>
                </div>
            </div>
        </div>
    );
}

function DailyReportModal({ date, jobs, staff, onClose }) {
    const dayJobs = jobs.filter(j => j.startDate <= date && j.endDate >= date);
    const allStaffIds = new Set();
    dayJobs.forEach(j => {
        (j.assignedStaffIds || []).forEach(id => allStaffIds.add(id));
    });
    const totalStaffCount = allStaffIds.size;
    const [isPrinting, setIsPrintMode] = useState(false);

    const handlePrint = () => {
        setIsPrintMode(true);
        setTimeout(() => {
            window.print();
            setIsPrintMode(false);
        }, 300);
    };

    const reportJSX = (
        <div className="printable-report">
            <div className="report-header">
                <div className="report-logo">WMC Operations</div>
                <div className="report-title">
                    <h1>Daily Operations Summary</h1>
                    <p>ประจำวันที่ {formatDate(date)}</p>
                </div>
            </div>

            <div className="report-stats">
                <div className="r-stat">
                    <span>จำนวนโปรเจกต์</span>
                    <strong>{dayJobs.length} งาน</strong>
                </div>
                <div className="r-stat">
                    <span>จำนวนพนักงานทั้งหมด</span>
                    <strong>{totalStaffCount} คน</strong>
                </div>
            </div>

            {dayJobs.map(job => {
                const currentTeamIds = job.assignedStaffIds || [];
                const jobTeam = currentTeamIds.map(id => staff.find(s => s.id === id)).filter(Boolean);
                
                if (jobTeam.length === 0) return null;

                const mainTask = job.notes;

                return (
                    <div key={job.id} className="report-job-section" style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '15px', marginBottom: '20px' }}>
                        <div className="r-job-header" style={{ borderBottom: 'none', marginBottom: '10px' }}>
                            <div className="r-job-info">
                                <h3 style={{ fontSize: '18px', color: 'var(--brand-primary)' }}>{job.projectName}</h3>
                                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '4px' }}>
                                    <span className="r-qt" style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px' }}>{job.qtNumber}</span>
                                    <span className="r-client"><strong>ลูกค้า:</strong> {job.clientName}</span>
                                </div>
                            </div>
                            <div className="r-job-meta">
                                <div className="r-time" style={{ fontSize: '16px', color: '#000' }}>
                                    <Clock size={16} /> <strong>{job.defaultCheckIn} - {job.defaultCheckOut}</strong>
                                </div>
                                <span className="badge" style={{ marginTop: '5px' }}>{job.jobType}</span>
                            </div>
                        </div>

                        <div style={{ background: '#fff9f9', padding: '10px', borderRadius: '6px', marginBottom: '15px', borderLeft: '4px solid var(--brand-primary)' }}>
                            <strong style={{ fontSize: '13px', color: '#64748b', display: 'block', marginBottom: '2px', textTransform: 'uppercase' }}>รายละเอียดงาน / หมายเหตุ:</strong>
                            <p style={{ fontSize: '15px', fontWeight: 500, margin: 0 }}>{mainTask || 'ไม่ระบุรายละเอียด'}</p>
                        </div>

                        <div>
                            <strong style={{ fontSize: '13px', color: '#64748b', display: 'block', marginBottom: '8px', textTransform: 'uppercase' }}>รายชื่อทีมงาน ({jobTeam.length} คน):</strong>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' }}>
                                {jobTeam.map(s => {
                                    return (
                                        <div key={s.id} style={{ fontSize: '14px', padding: '6px 10px', background: '#f8fafc', borderRadius: '4px', border: '1px solid #f1f5f9' }}>
                                            <strong>{s.nickname}</strong>
                                            <span style={{ color: getRoleColor(s.role), fontSize: '12px', marginLeft: '5px', fontWeight: 600 }}>({s.role})</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                );
            })}

            <div className="report-footer">
                <p>พิมพ์เมื่อ: {new Date().toLocaleString('th-TH')}</p>
                <div className="signatures">
                    <div className="sig-box">ผู้สรุปรายงาน..........................</div>
                    <div className="sig-box">ผู้ตรวจสอบ..........................</div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal modal-lg">
                <div className="modal-header">
                    <div>
                        <h2>ตัวอย่างรายงานประจำวัน</h2>
                        <p style={{ fontSize: '14px', color: 'var(--text-tertiary)' }}>{formatDate(date)}</p>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn btn-primary" onClick={handlePrint}>
                            <Printer size={16} /> พิมพ์รายงาน / PDF
                        </button>
                        <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={18} /></button>
                    </div>
                </div>
                <div className="modal-body">
                    {reportJSX}
                </div>
            </div>
            {isPrinting && createPortal(reportJSX, document.getElementById('print-root'))}
        </div>
    );
}
