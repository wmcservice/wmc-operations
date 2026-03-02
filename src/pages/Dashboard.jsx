import { useState, useMemo, useEffect } from 'react';
import {
    Briefcase, Users, AlertTriangle, Clock, TrendingUp, CheckCircle2, AlertCircle, CalendarDays, Loader2
} from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend,
} from 'recharts';
import { supabase } from '../lib/supabaseClient';
import { getJobs, getStaff, getAllocations, saveJob } from '../data/store';
import { getStatusColor, formatDateShort, getTodayStr, getJobDuration, statusToKey, jobTypeToKey, formatDate, getPriorityColor, getRoleColor, compressImage } from '../utils/helpers';
import { STATUS_COLORS, JOB_STATUSES, JOB_TYPES, PRIORITIES } from '../data/models';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, isWithinInterval, parseISO } from 'date-fns';
import './Dashboard.css';

export default function Dashboard() {
    const todayStr = getTodayStr();
    const [period, setPeriod] = useState('week'); 
    const [customStart, setCustomStart] = useState(todayStr);
    const [customEnd, setCustomEnd] = useState(todayStr);
    const [selectedStaff, setSelectedStaff] = useState(null);
    const [selectedJob, setSelectedJob] = useState(null);
    const [jobs, setJobs] = useState([]);
    const [staff, setStaff] = useState([]);
    const [allocations, setAllocations] = useState([]);
    const [loading, setLoading] = useState(true);
    
    const currentDate = useMemo(() => parseISO(todayStr), [todayStr]);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            // Fetch Staff
            const { data: staffData } = await supabase.from('staff').select('*');
            if (staffData) {
                setStaff(staffData.map(s => ({
                    id: s.id,
                    nickname: s.nickname,
                    fullName: s.full_name,
                    role: s.role,
                    isActive: s.is_active
                })));
            }

            // Fetch Jobs
            const { data: jobsData } = await supabase.from('jobs').select(`
                *,
                sub_tasks (*),
                attachments (*),
                progress_logs (*, log_staff_assignments(staff_id))
            `);
            
            // Fetch Allocations for member mapping
            const { data: allocData } = await supabase.from('allocations').select('*');
            setAllocations(allocData || []);

            if (jobsData) {
                const formatted = jobsData.map(j => {
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
                        subTasks: (j.sub_tasks || []).map(st => ({ id: st.id, title: st.title, isCompleted: st.is_completed })),
                        attachments: (j.attachments || []).map(a => ({ id: a.id, name: a.name, url: a.url, type: a.type })),
                        progressLogs: (j.progress_logs || []).map(pl => ({
                            id: pl.id,
                            date: pl.log_date,
                            text: pl.text,
                            author: pl.author,
                            workerIds: (pl.log_staff_assignments || []).map(lsa => lsa.staff_id)
                        })),
                        assignedStaffIds: uniqueStaffIds
                    };
                });
                setJobs(formatted);
            }
        } catch (error) {
            console.error('Error fetching data:', error);
        } finally {
            setLoading(false);
        }
    };

    const refresh = fetchData;

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

    const dateRange = useMemo(() => {
        try {
            switch (period) {
                case 'day': return { start: startOfDay(currentDate), end: endOfDay(currentDate) };
                case 'week': return { start: startOfWeek(currentDate, { weekStartsOn: 1 }), end: endOfWeek(currentDate, { weekStartsOn: 1 }) };
                case 'month': return { start: startOfMonth(currentDate), end: endOfMonth(currentDate) };
                case 'year': return { start: startOfYear(currentDate), end: endOfYear(currentDate) };
                case 'custom': return { start: startOfDay(parseISO(customStart)), end: endOfDay(parseISO(customEnd)) };
                default: return { start: startOfWeek(currentDate), end: endOfWeek(currentDate) };
            }
        } catch (e) {
            return { start: new Date(), end: new Date() };
        }
    }, [period, currentDate, customStart, customEnd]);

    const stats = useMemo(() => {
        try {
            const isInPeriod = (date) => {
                if (!date) return false;
                try {
                    const d = typeof date === 'string' ? parseISO(date) : date;
                    return isWithinInterval(d, dateRange);
                } catch(e) { return false; }
            };
            
            const periodAllocs = (allocations || []).filter(a => isInPeriod(a?.date));
            const activeJobs = (jobs || []).filter(j => 
                (isInPeriod(j?.startDate) || isInPeriod(j?.endDate) || (j?.startDate && parseISO(j.startDate) <= dateRange.start && j?.endDate && parseISO(j.endDate) >= dateRange.end))
                && j?.status !== 'เสร็จสมบูรณ์'
            );
            
            const inProgress = activeJobs.filter(j => j?.status === 'กำลังดำเนินการ');
            const jobsWithIssues = (jobs || []).filter(j => j?.currentIssues && j.currentIssues.trim() !== '' && j.status !== 'เสร็จสมบูรณ์');
            
            const totalProgress = activeJobs.reduce((sum, j) => sum + (j?.overallProgress || 0), 0);
            const avgProgress = activeJobs.length > 0 ? Math.round(totalProgress / activeJobs.length) : 0;
            
            const totalOT = periodAllocs.reduce((sum, a) => sum + (a?.overtimeHours || 0), 0);

            return { activeJobs, inProgress, jobsWithIssues, avgProgress, totalOT, periodAllocs };
        } catch (e) {
            console.error('Stats error:', e);
            return { activeJobs: [], inProgress: [], jobsWithIssues: [], avgProgress: 0, totalOT: 0, periodAllocs: [] };
        }
    }, [jobs, allocations, dateRange]);

    // Status chart data
    const statusData = useMemo(() => {
        try {
            const counts = {};
            (jobs || []).forEach(j => { if (j?.status) counts[j.status] = (counts[j.status] || 0) + 1; });
            return Object.entries(counts).map(([name, value]) => ({ name, value }));
        } catch(e) { return []; }
    }, [jobs]);

    // High Priority Jobs
    const criticalJobs = useMemo(() => {
        try {
            return (jobs || []).filter(j => j?.status === 'ต้องแก้ไข' || j?.priority === 'ด่วนที่สุด' || j?.priority === 'สูง')
                .sort((a, b) => (a?.status === 'ต้องแก้ไข' ? -1 : 1))
                .slice(0, 5);
        } catch(e) { return []; }
    }, [jobs]);

    // Gantt data
    const ganttJobs = useMemo(() => {
        try {
            return [...(jobs || [])]
                .filter(j => j?.status !== 'เสร็จสมบูรณ์')
                .sort((a, b) => (a?.startDate || '').localeCompare(b?.startDate || ''));
        } catch(e) { return []; }
    }, [jobs]);

    // Resource heatmap
    const heatmapData = useMemo(() => {
        try {
            const activeStaff = (staff || []).filter(s => s?.isActive);
            return activeStaff.map(s => {
                const staffAllocs = (stats?.periodAllocs || []).filter(a => a?.staff_id === s?.id);
                const totalHours = staffAllocs.reduce((sum, a) => sum + (a?.actual_hours || a?.assigned_hours || 0), 0);
                const jobCount = new Set(staffAllocs.map(a => a?.job_id)).size;
                return { ...s, totalHours, jobCount };
            }).sort((a, b) => b.totalHours - a.totalHours);
        } catch(e) { return []; }
    }, [staff, stats.periodAllocs]);

    const availabilityData = useMemo(() => {
        try {
            const levels = { idle: 0, normal: 0, busy: 0, overloaded: 0 };
            (heatmapData || []).forEach(s => {
                const load = s?.totalHours || 0;
                if (load === 0) levels.idle++;
                else if (load <= 8) levels.normal++;
                else if (load <= 12) levels.busy++;
                else levels.overloaded++;
            });
            return [
                { name: 'ว่าง', value: levels.idle, color: '#6b7280' },
                { name: 'ปกติ', value: levels.normal, color: '#10b981' },
                { name: 'ยุ่ง', value: levels.busy, color: '#f59e0b' },
                { name: 'งานล้น', value: levels.overloaded, color: '#ef4444' }
            ].filter(d => d.value > 0);
        } catch(e) { return []; }
    }, [heatmapData]);

    const idleStaffNames = useMemo(() => {
        try {
            return (heatmapData || []).filter(s => s?.totalHours === 0).map(s => s?.nickname);
        } catch(e) { return []; }
    }, [heatmapData]);

    const PIE_COLORS = ['#6b7280', '#3b82f6', '#f59e0b', '#10b981', '#ef4444'];

    if (loading && jobs.length === 0) {
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
                    <h1>ศูนย์ควบคุมปฏิบัติการ</h1>
                    <p className="subtitle">ภาพรวมช่วง {period === 'day' ? 'วันนี้' : period === 'week' ? 'สัปดาห์นี้' : period === 'month' ? 'เดือนนี้' : 'ปีนี้'} • {formatDate(dateRange.start.toISOString())} - {formatDate(dateRange.end.toISOString())}</p>
                </div>
                <div className="period-selector-wrapper" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
                    <div className="period-selector">
                        <button className={`period-btn ${period === 'day' ? 'active' : ''}`} onClick={() => setPeriod('day')}>รายวัน</button>
                        <button className={`period-btn ${period === 'week' ? 'active' : ''}`} onClick={() => setPeriod('week')}>สัปดาห์</button>
                        <button className={`period-btn ${period === 'month' ? 'active' : ''}`} onClick={() => setPeriod('month')}>เดือน</button>
                        <button className={`period-btn ${period === 'year' ? 'active' : ''}`} onClick={() => setPeriod('year')}>รายปี</button>
                        <button className={`period-btn ${period === 'custom' ? 'active' : ''}`} onClick={() => setPeriod('custom')}>กำหนดเอง</button>
                    </div>
                    {period === 'custom' && (
                        <div className="custom-range-picker" style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-tertiary)', padding: '4px 8px', borderRadius: 'var(--radius-md)' }}>
                            <input type="date" className="input" style={{ padding: '2px 8px', fontSize: '13px' }} value={customStart} onChange={e => setPeriod('custom') || setCustomStart(e.target.value)} />
                            <span style={{ fontSize: '12px', fontWeight: 600 }}>ถึง</span>
                            <input type="date" className="input" style={{ padding: '2px 8px', fontSize: '13px' }} value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
                        </div>
                    )}
                </div>
            </div>

            {/* Critical Alerts Section */}
            {criticalJobs.length > 0 && (
                <div className="card critical-card" style={{ marginBottom: 'var(--space-5)', borderLeft: '4px solid var(--status-needs-fix)' }}>
                    <div className="card-header" style={{ padding: 'var(--space-3) var(--space-4)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--status-needs-fix)' }}>
                            <AlertCircle size={18} />
                            <h3 style={{ fontSize: '16px' }}>งานที่ต้องดูแลเร่งด่วน ({criticalJobs.length})</h3>
                        </div>
                    </div>
                    <div className="card-body" style={{ padding: '0' }}>
                        <div className="critical-list">
                            {criticalJobs.map(job => (
                                <div 
                                    key={job.id} 
                                    className="critical-item" 
                                    style={{ 
                                        display: 'flex', 
                                        justifyContent: 'space-between', 
                                        padding: '12px 16px', 
                                        borderBottom: '1px solid var(--border-primary)',
                                        cursor: 'pointer'
                                    }}
                                    onClick={() => setSelectedJob(job)}
                                >
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: '14px' }}>{job.projectName}</div>
                                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{job.clientName} • {job.qtNumber}</div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <span className={`badge badge-${statusToKey(job.status)}`} style={{ fontSize: '10px' }}>{job.status}</span>
                                        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--status-needs-fix)', marginTop: '4px' }}>ความสำคัญ: {job.priority}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* KPI Cards */}
            <div className="kpi-grid">
                <div className="kpi-card blue">
                    <div className="kpi-icon blue"><Briefcase size={22} /></div>
                    <div className="kpi-info">
                        <div className="kpi-label">งานในช่วงนี้</div>
                        <div className="kpi-value">{stats.activeJobs.length}</div>
                        <div className="kpi-sub">กำลังดำเนินการ {stats.inProgress.length} งาน</div>
                    </div>
                </div>
                <div className="kpi-card cyan">
                    <div className="kpi-icon cyan"><TrendingUp size={22} /></div>
                    <div className="kpi-info">
                        <div className="kpi-label">ความคืบหน้าเฉลี่ย</div>
                        <div className="kpi-value">{stats.avgProgress}%</div>
                        <div className="kpi-sub">จากงานที่กำลังทำงานอยู่</div>
                    </div>
                </div>
                <div className="kpi-card red">
                    <div className="kpi-icon red"><AlertTriangle size={22} /></div>
                    <div className="kpi-info">
                        <div className="kpi-label">งานที่ติดปัญหา</div>
                        <div className="kpi-value">{stats.jobsWithIssues.length}</div>
                        <div className="kpi-sub">รอการแก้ไขด่วน</div>
                    </div>
                </div>
                <div className="kpi-card yellow">
                    <div className="kpi-icon yellow"><CheckCircle2 size={22} /></div>
                    <div className="kpi-info">
                        <div className="kpi-label">ทีมงานที่ว่าง</div>
                        <div className="kpi-value">{idleStaffNames.length}</div>
                        <div className="kpi-sub">พร้อมรับงานใหม่ทันที</div>
                    </div>
                </div>
            </div>

            {/* Charts Row */}
            <div className="dashboard-grid">
                {/* Gantt Timeline */}
                <div className="card gantt-card">
                    <div className="card-header">
                        <h3>ไทม์ไลน์โปรเจกต์</h3>
                        <span className="badge badge-in-progress">กำลังดำเนินการ {ganttJobs.length} งาน</span>
                    </div>
                    <div className="card-body gantt-body">
                        {ganttJobs.length === 0 ? (
                            <div className="empty-state"><p>ไม่มีโปรเจกต์ที่กำลังดำเนินการ</p></div>
                        ) : (
                            <div className="gantt-chart">
                                {ganttJobs.map(job => {
                                    const duration = getJobDuration(job.startDate, job.endDate);
                                    const statusClass = statusToKey(job.status);
                                    const typeClass = jobTypeToKey(job.jobType);
                                    return (
                                        <div 
                                            key={job.id} 
                                            className="gantt-row" 
                                            style={{ cursor: 'pointer' }}
                                            onClick={() => setSelectedJob(job)}
                                        >
                                            <div className="gantt-label">
                                                <span className="gantt-project">{job.projectName}</span>
                                                <span className="gantt-meta">{job.clientName} • {job.jobType}</span>
                                            </div>
                                            <div className="gantt-bar-wrapper">
                                                <div
                                                    className={`gantt-bar type-${typeClass}`}
                                                    style={{ width: `${Math.min(duration * 12, 100)}%` }}
                                                    title={`${formatDateShort(job.startDate)} → ${formatDateShort(job.endDate)} (${duration} วัน)`}
                                                >
                                                    <span className="gantt-bar-text">
                                                        {formatDateShort(job.startDate)} → {formatDateShort(job.endDate)}
                                                    </span>
                                                </div>
                                            </div>
                                            <span className={`badge badge-${statusClass}`}>{job.status}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* Status Breakdown */}
                <div className="card status-chart-card">
                    <div className="card-header">
                        <h3>สัดส่วนสถานะงาน</h3>
                    </div>
                    <div className="card-body chart-body">
                        {statusData.length > 0 ? (
                            <ResponsiveContainer width="100%" height={260}>
                                <PieChart>
                                    <Pie
                                        data={statusData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={55}
                                        outerRadius={90}
                                        paddingAngle={3}
                                        dataKey="value"
                                        label={({ name, value }) => `${name}: ${value}`}
                                        labelLine={false}
                                    >
                                        {statusData.map((entry, i) => (
                                            <Cell key={i} fill={STATUS_COLORS[entry.name] || PIE_COLORS[i % PIE_COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip />
                                </PieChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="empty-state"><p>ไม่มีข้อมูล</p></div>
                        )}
                    </div>
                </div>
            </div>

            {/* Resource Section */}
            <div className="dashboard-grid" style={{ marginTop: 'var(--space-5)' }}>
                {/* Availability Summary */}
                <div className="card">
                    <div className="card-header">
                        <h3>สรุปความพร้อมของพนักงาน</h3>
                    </div>
                    <div className="card-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', alignItems: 'center' }}>
                        <div style={{ height: '200px' }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={availabilityData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={40}
                                        outerRadius={70}
                                        paddingAngle={5}
                                        dataKey="value"
                                    >
                                        {availabilityData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                        ))}
                                    </Pie>
                                    <Tooltip />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="idle-staff-list-container">
                            <h4 style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '8px' }}>พนักงานที่ว่างอยู่ ({idleStaffNames.length})</h4>
                            <div className="idle-staff-tags" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', maxHeight: '150px', overflowY: 'auto' }}>
                                {idleStaffNames.length > 0 ? (
                                    idleStaffNames.map(name => (
                                        <span key={name} style={{ background: 'var(--bg-tertiary)', padding: '2px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 500 }}>
                                            {name}
                                        </span>
                                    ))
                                ) : (
                                    <span style={{ fontSize: '12px', fontStyle: 'italic', color: 'var(--text-tertiary)' }}>ไม่มีคนว่าง</span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Resource Heatmap Grid */}
                <div className="card">
                    <div className="card-header">
                        <h3>แผนผังการใช้พนักงาน</h3>
                        <span className="badge badge-queue">พนักงานทั้งหมด {staff.filter(s => s.isActive).length} คน</span>
                    </div>
                    <div className="card-body">
                        <div className="heatmap-grid">
                            {heatmapData.map(s => {
                                const load = s.totalHours;
                                const loadLevel = load === 0 ? 'idle' : load <= 8 ? 'normal' : load <= 12 ? 'busy' : 'overloaded';
                                return (
                                    <div 
                                        key={s.id} 
                                        className={`heatmap-cell ${loadLevel}`}
                                        style={{ cursor: 'pointer' }}
                                        onClick={() => setSelectedStaff(s)}
                                    >
                                        <div className="heatmap-avatar">{s.nickname.charAt(0)}</div>
                                        <div className="heatmap-info">
                                            <span className="heatmap-name">{s.nickname}</span>
                                            <span className="heatmap-hours">{s.totalHours.toFixed(1)} ชม.</span>
                                        </div>
                                        <div className={`heatmap-indicator ${loadLevel}`} title={loadLevel}></div>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="heatmap-legend">
                            <span><span className="legend-dot idle"></span> ว่าง (0)</span>
                            <span><span className="legend-dot normal"></span> ปกติ (1-8)</span>
                            <span><span className="legend-dot busy"></span> ยุ่ง (9-12)</span>
                            <span><span className="legend-dot overloaded"></span> งานล้น (12+)</span>
                        </div>
                    </div>
                </div>
            </div>

            {selectedStaff && (
                <StaffDetailModal
                    staffMember={selectedStaff}
                    jobs={jobs}
                    onClose={() => setSelectedStaff(null)}
                />
            )}

            {selectedJob && (
                <JobDetailModal
                    job={selectedJob}
                    staff={staff}
                    user={user}
                    onClose={() => setSelectedJob(null)}
                    onStatusChange={handleStatusChange}
                    onUpdate={() => {
                        refresh();
                        const updated = getJobs().find(j => j.id === selectedJob.id);
                        if (updated) setSelectedJob({...updated});
                    }}
                />
            )}
        </div>
    );
}

function JobDetailModal({ job, staff, user, onClose, onUpdate, onStatusChange }) {
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
                                ยังไม่ได้ระบุทีมงาน
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

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto', paddingRight: '4px' }}>
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

function StaffDetailModal({ staffMember, jobs, onClose }) {
    const staffJobs = useMemo(() => {
        return jobs.filter(j => j.assignedStaffIds?.includes(staffMember.id));
    }, [staffMember.id, jobs]);

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal" style={{ maxWidth: '800px' }}>
                <div className="modal-header">
                    <div>
                        <h2>{staffMember.nickname} ({staffMember.fullName})</h2>
                        <p className="subtitle">ประวัติการได้รับมอบหมายงาน</p>
                    </div>
                    <button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button>
                </div>
                <div className="modal-body">
                    <div className="kpi-grid" style={{ marginBottom: '20px', gridTemplateColumns: 'repeat(2, 1fr)' }}>
                        <div className="kpi-card blue" style={{ padding: '15px' }}>
                            <div className="kpi-label">งานทั้งหมด</div>
                            <div className="kpi-value" style={{ fontSize: '24px' }}>{staffJobs.length}</div>
                        </div>
                        <div className="kpi-card yellow" style={{ padding: '15px' }}>
                            <div className="kpi-label">ตำแหน่ง</div>
                            <div className="kpi-value" style={{ fontSize: '18px', color: getRoleColor(staffMember.role) }}>{staffMember.role}</div>
                        </div>
                    </div>

                    <h4 style={{ fontSize: '14px', marginBottom: '12px' }}>โปรเจกต์ที่รับผิดชอบ</h4>
                    {staffJobs.length > 0 ? (
                        <div className="table-wrapper">
                            <table style={{ width: '100%', fontSize: '13px' }}>
                                <thead>
                                    <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-primary)' }}>
                                        <th style={{ padding: '8px' }}>เลขที่ QT</th>
                                        <th style={{ padding: '8px' }}>ชื่อโปรเจกต์</th>
                                        <th style={{ padding: '8px' }}>ลูกค้า</th>
                                        <th style={{ padding: '8px' }}>สถานะ</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {staffJobs.map(j => (
                                        <tr key={j.id} style={{ borderBottom: '1px solid var(--border-primary)' }}>
                                            <td style={{ padding: '8px', fontWeight: 600 }}>{j.qtNumber || '-'}</td>
                                            <td style={{ padding: '8px' }}>{j.projectName}</td>
                                            <td style={{ padding: '8px' }}>{j.clientName}</td>
                                            <td style={{ padding: '8px' }}>
                                                <span className={`badge badge-${statusToKey(j.status)}`}>
                                                    {j.status}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div style={{ textAlign: 'center', padding: '40px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                            <p style={{ color: 'var(--text-tertiary)' }}>ไม่มีประวัติการรับงาน</p>
                        </div>
                    )}
                </div>
                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>ปิดหน้าต่าง</button>
                </div>
            </div>
        </div>
    );
}
