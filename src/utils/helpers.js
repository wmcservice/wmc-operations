import { format, addDays, startOfWeek, eachDayOfInterval, differenceInCalendarDays, isWithinInterval, parseISO, startOfMonth, endOfMonth, endOfWeek } from 'date-fns';

export function formatDate(dateStr) {
    if (!dateStr) return '';
    return format(parseISO(dateStr), 'dd/MM/yyyy');
}

export function formatDateShort(dateStr) {
    if (!dateStr) return '';
    return format(parseISO(dateStr), 'dd/MM');
}

export function formatDay(dateStr) {
    if (!dateStr) return '';
    return format(parseISO(dateStr), 'EEE');
}

export function getWeekDates(referenceDate = new Date()) {
    const start = startOfWeek(referenceDate, { weekStartsOn: 1 }); // Monday
    return Array.from({ length: 7 }, (_, i) => {
        const d = addDays(start, i);
        return d.toISOString().split('T')[0];
    });
}

export function getMonthDates(referenceDate = new Date()) {
    const monthStart = startOfMonth(referenceDate);
    // Start from the Monday before (or on) the 1st of the month
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });

    // Always return 42 days (6 weeks) to keep the grid height consistent
    return Array.from({ length: 42 }, (_, i) => {
        const d = addDays(calendarStart, i);
        return d.toISOString().split('T')[0];
    });
}

export function formatMonthYear(dateStr) {
    if (!dateStr) return '';
    return format(parseISO(dateStr), 'MMMM yyyy');
}

export function getTodayStr() {
    return new Date().toISOString().split('T')[0];
}

export function getDateRange(startStr, endStr) {
    return eachDayOfInterval({
        start: parseISO(startStr),
        end: parseISO(endStr),
    }).map(d => d.toISOString().split('T')[0]);
}

export function getJobDuration(startDate, endDate) {
    return differenceInCalendarDays(parseISO(endDate), parseISO(startDate)) + 1;
}

export function isDateInRange(dateStr, startStr, endStr) {
    return isWithinInterval(parseISO(dateStr), {
        start: parseISO(startStr),
        end: parseISO(endStr),
    });
}

export function getStatusColor(status) {
    const colors = {
        'รอคิว': '#6b7280',
        'กำลังดำเนินการ': '#3b82f6',
        'ตรวจสอบ': '#f59e0b',
        'เสร็จสมบูรณ์': '#10b981',
        'ต้องแก้ไข': '#ef4444',
        // Fallback for English keys if any
        'Queue': '#6b7280',
        'In-Progress': '#3b82f6',
        'Review': '#f59e0b',
        'Completed': '#10b981',
        'Needs Fix': '#ef4444',
    };
    return colors[status] || '#6b7280';
}

export function getPriorityColor(priority) {
    const colors = {
        'ต่ำ': '#6b7280',
        'ปกติ': '#3b82f6',
        'สูง': '#f59e0b',
        'ด่วนที่สุด': '#ef4444',
        // Fallback for English keys
        'Low': '#6b7280',
        'Normal': '#3b82f6',
        'High': '#f59e0b',
        'Urgent': '#ef4444',
    };
    return colors[priority] || '#6b7280';
}

export function getRoleColor(role) {
    const mapping = {
        'ช่างหน้างาน': '#3b82f6', // Blue
        'ออฟฟิศ': '#8b5cf6',      // Purple
        'ทีมนอก': '#64748b',      // Slate
        'หัวหน้าทีม': '#10b981',   // Green
        'ซุปเปอร์ไวเซอร์': '#f59e0b', // Amber
        'พนักงานขับรถ': '#ec4899', // Pink
        'พนักงาน (ทีมนอก)': '#64748b' // Slate
    };
    return mapping[role] || '#6b7280';
}

export function statusToKey(status) {
    const mapping = {
        'รอคิว': 'queue',
        'กำลังดำเนินการ': 'in-progress',
        'ตรวจสอบ': 'review',
        'เสร็จสมบูรณ์': 'completed',
        'ต้องแก้ไข': 'needs-fix'
    };
    return mapping[status] || status?.toLowerCase().replace(/\s+/g, '-') || '';
}

export function getJobTypeColor(type) {
    const colors = {
        'ติดตั้ง': '#dc2626',   // Red
        'ขนย้าย': '#2563eb',   // Blue
        'โหลด': '#059669',     // Green
        'โกดัง': '#7c3aed',     // Purple
        'ทำของ': '#ea580c',     // Orange
        'มาร์กไลน์': '#db2777', // Pink
        'อื่นๆ': '#4b5563'      // Gray
    };
    return colors[type] || '#4b5563';
}

export function jobTypeToKey(type) {
    const mapping = {
        'ติดตั้ง': 'install',
        'ขนย้าย': 'move',
        'โหลด': 'load',
        'โกดัง': 'warehouse',
        'ทำของ': 'prep',
        'มาร์กไลน์': 'marking',
        'อื่นๆ': 'other'
    };
    return mapping[type] || 'other';
}

export function classNames(...classes) {
    return classes.filter(Boolean).join(' ');
}

/**
 * Resizes and compresses an image file
 * @param {File} file - The image file to compress
 * @param {Object} options - Compression options
 * @returns {Promise<string>} - Base64 string of compressed image
 */
export async function compressImage(file, { maxWidth = 1024, maxHeight = 1024, quality = 0.7 } = {}) {
    return new Promise((resolve, reject) => {
        if (!file.type.startsWith('image/')) {
            reject(new Error('File is not an image'));
            return;
        }

        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                // Calculate new dimensions
                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = Math.round((width * maxHeight) / height);
                        height = maxHeight;
                    }
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Convert to base64 with quality adjustment
                // Using image/jpeg for better compression
                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                resolve(dataUrl);
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (err) => reject(err);
    });
}
