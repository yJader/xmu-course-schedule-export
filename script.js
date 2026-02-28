// ==UserScript==
// @name         厦门大学课程表导出助手-ICS(功能修复版)
// @version      2026-02-28
// @description  基于 yangqian 的原版脚本进行修复和功能增强。解决了因教务系统更新导致的失效问题，支持任意节数连上课程, 支持日程提醒配置。
// @author       jader (原作者 pydroid)
// @match        https://jw.xmu.edu.cn/gsapp/sys/wdkbapp/*
// @grant        none
// @license      MIT License
// @namespace    https://greasyfork.org/zh-CN/users/1515284-%E4%BA%A6%E7%91%BE
// ==/UserScript==

(function () {
    'use strict';

    // ================== 配置区域 ==================
    const DEBUG = true;
    // 【新功能】 在此设置课前提醒，单位为分钟。可以设置多个，例如 [15, 5]
    // 如果不需要提醒，请设置为空数组 []
    const REMINDER_MINUTES = [10];
    const START_DATE_STORAGE_KEY = 'xmu_ics_start_date_by_semester';
    const START_DATE_INPUT_ID = 'xmu-ics-start-date-input';
    const START_DATE_RESET_CLASS = 'xmu-ics-reset-default-btn';
    const UNKNOWN_SEMESTER_LABEL = '未知学期';
    // ============================================

    const periodTimes = [
        { jc: 1, start: [8, 0], end: [8, 45] }, { jc: 2, start: [8, 55], end: [9, 40] },
        { jc: 3, start: [10, 10], end: [10, 55] }, { jc: 4, start: [11, 5], end: [11, 50] },
        { jc: 5, start: [14, 30], end: [15, 15] }, { jc: 6, start: [15, 25], end: [16, 10] },
        { jc: 7, start: [16, 40], end: [17, 25] }, { jc: 8, start: [17, 35], end: [18, 20] },
        { jc: 9, start: [19, 10], end: [19, 55] }, { jc: 10, start: [20, 5], end: [20, 50] },
        { jc: 11, start: [21, 0], end: [21, 45] }
    ];

    const log = (message, ...args) => {
        if (DEBUG) console.log(`[课表助手] ${message}`, ...args);
    };

    const formatDateForInput = (date) => `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
    const formatDateForIcs = (date) => `${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}`;
    const isValidDateString = (dateStr) => /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !Number.isNaN(new Date(`${dateStr}T00:00:00`).getTime());
    const parseDateInput = (dateStr) => {
        const [yearStr, monthStr, dayStr] = dateStr.split('-');
        return new Date(parseInt(yearStr, 10), parseInt(monthStr, 10) - 1, parseInt(dayStr, 10));
    };

    const getSemesterSelect = () => document.getElementById('myXnxqSelect');
    const getSemesterLabel = () => {
        const semesterSelect = getSemesterSelect();
        const selected = semesterSelect?.selectedOptions?.[0]?.textContent?.trim();
        return selected || UNKNOWN_SEMESTER_LABEL;
    };
    const parseSemesterLabel = (semesterLabel) => {
        const semesterMatch = semesterLabel.match(/^(\d{4})-(\d{4})学年\s*(春季|秋季|夏季)学期$/);
        if (!semesterMatch) return null;
        const [, startYearStr, endYearStr, termType] = semesterMatch;
        return { startYear: parseInt(startYearStr, 10), endYear: parseInt(endYearStr, 10), termType };
    };
    const getFirstMonday = (year, month) => {
        const firstDay = new Date(year, month - 1, 1);
        const dayOfWeek = firstDay.getDay();
        const offset = dayOfWeek === 0 ? 1 : (8 - dayOfWeek) % 7;
        return new Date(year, month - 1, 1 + offset);
    };
    const computeDefaultStartDate = (semesterLabel) => {
        const semesterInfo = parseSemesterLabel(semesterLabel);
        if (!semesterInfo) {
            log(`学期格式无法解析，回退为今天: ${semesterLabel}`);
            return formatDateForInput(new Date());
        }

        let year;
        let month;
        if (semesterInfo.termType === '春季') {
            year = semesterInfo.endYear;
            month = 3;
        } else if (semesterInfo.termType === '秋季') {
            year = semesterInfo.startYear;
            month = 9;
        } else {
            year = semesterInfo.endYear;
            month = 7;
        }
        return formatDateForInput(getFirstMonday(year, month));
    };

    const getStoredDateMap = () => {
        try {
            const raw = localStorage.getItem(START_DATE_STORAGE_KEY);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return {};
            return parsed;
        } catch (error) {
            log('读取本地日期配置失败，已忽略。', error);
            return {};
        }
    };
    const saveStoredDateMap = (dateMap) => {
        try {
            localStorage.setItem(START_DATE_STORAGE_KEY, JSON.stringify(dateMap));
        } catch (error) {
            log('保存本地日期配置失败，已忽略。', error);
        }
    };
    const getStoredStartDate = (semesterLabel) => {
        const dateMap = getStoredDateMap();
        const candidate = dateMap[semesterLabel];
        return isValidDateString(candidate) ? candidate : null;
    };
    const setStoredStartDate = (semesterLabel, startDate) => {
        if (!semesterLabel || !isValidDateString(startDate)) return;
        const dateMap = getStoredDateMap();
        dateMap[semesterLabel] = startDate;
        saveStoredDateMap(dateMap);
    };
    const getPreferredStartDate = (semesterLabel) => getStoredStartDate(semesterLabel) || computeDefaultStartDate(semesterLabel);
    const updateDateInputForSemester = () => {
        const dateInput = document.getElementById(START_DATE_INPUT_ID);
        if (!dateInput) return;
        const semesterLabel = getSemesterLabel();
        dateInput.value = getPreferredStartDate(semesterLabel);
        log(`日期输入框已更新: 学期=${semesterLabel}, 日期=${dateInput.value}`);
    };

    const waitUntilElementPresent = (cssLocator, callback) => {
        log(`脚本启动，正在等待课表元素 '${cssLocator}' 加载...`);
        const checkExist = setInterval(() => {
            if (document.querySelector(cssLocator)) {
                clearInterval(checkExist);
                log(`课表元素已找到，准备添加 '导出ICS' 按钮。`);
                callback();
                return;
            }
        }, 100);
    };

    waitUntilElementPresent(".arrage", () => {
        const tab = document.getElementById("xsXx")?.firstElementChild;
        if (!tab) { console.error("[课表助手] 无法找到按钮的挂载点 '#xsXx'。"); return; }
        if (tab.querySelector('.export-ics-btn')) return;

        const dateLabel = document.createElement('span');
        dateLabel.style.marginLeft = '8px';
        dateLabel.style.marginRight = '6px';
        dateLabel.textContent = '学期开始日期';

        const dateInput = document.createElement('input');
        dateInput.type = 'date';
        dateInput.id = START_DATE_INPUT_ID;
        dateInput.style.marginRight = '6px';

        const resetButton = document.createElement('a');
        resetButton.href = 'javascript:void(0);';
        resetButton.textContent = '恢复默认';
        resetButton.classList.add('bh-btn-default', 'bh-btn', START_DATE_RESET_CLASS);
        resetButton.style.marginRight = '8px';

        tab.appendChild(dateLabel);
        tab.appendChild(dateInput);
        tab.appendChild(resetButton);

        const getButton = document.createElement('a');
        getButton.innerHTML = "导出ICS";
        getButton.classList.add("bh-btn-default", "bh-btn", "export-ics-btn");
        tab.appendChild(getButton);

        updateDateInputForSemester();

        const semesterSelect = getSemesterSelect();
        if (semesterSelect) {
            semesterSelect.addEventListener('change', () => {
                updateDateInputForSemester();
            });
        } else {
            log('未找到学期下拉框 #myXnxqSelect，按未知学期处理。');
        }

        dateInput.addEventListener('change', () => {
            if (!isValidDateString(dateInput.value)) {
                const semesterLabel = getSemesterLabel();
                dateInput.value = computeDefaultStartDate(semesterLabel);
                alert(`开始日期格式无效，已恢复为默认值：${dateInput.value}`);
                return;
            }
            setStoredStartDate(getSemesterLabel(), dateInput.value);
        });

        resetButton.addEventListener('click', () => {
            const semesterLabel = getSemesterLabel();
            const defaultDate = computeDefaultStartDate(semesterLabel);
            dateInput.value = defaultDate;
            setStoredStartDate(semesterLabel, defaultDate);
            log(`已恢复默认开始日期: 学期=${semesterLabel}, 日期=${defaultDate}`);
        });

        getButton.addEventListener('click', main);
        log("'导出ICS' 按钮已成功添加到页面。");
    });

    function main() {
        log("===== 开始执行课表导出主程序 =====");
        const semesterLabel = getSemesterLabel();
        const dateInput = document.getElementById(START_DATE_INPUT_ID);
        let startDateStr = dateInput?.value?.trim() || '';
        if (!isValidDateString(startDateStr)) {
            startDateStr = getPreferredStartDate(semesterLabel);
            if (dateInput) dateInput.value = startDateStr;
            alert(`开始日期为空或格式无效，已自动使用：${startDateStr}`);
        }
        setStoredStartDate(semesterLabel, startDateStr);

        const HEADERS = [
            "BEGIN:VCALENDAR", "METHOD:PUBLISH", "VERSION:2.0",
            `X-WR-CALNAME:XMU课程表(${semesterLabel})`, "X-WR-TIMEZONE:Asia/Shanghai", "CALSCALE:GREGORIAN",
            "BEGIN:VTIMEZONE", "TZID:Asia/Shanghai", "END:VTIMEZONE"
        ];
        const FOOTERS = ["END:VCALENDAR"];

        const formatTime = (timeArray) => `${timeArray[0].toString().padStart(2, '0')}${timeArray[1].toString().padStart(2, '0')}00`;
        const getStartTime = (startJc) => periodTimes[startJc - 1]?.start ? formatTime(periodTimes[startJc - 1].start) : null;
        const getEndTime = (startJc, duration) => {
            const endJc = startJc + duration - 1;
            return periodTimes[endJc - 1]?.end ? formatTime(periodTimes[endJc - 1].end) : null;
        };
        const getFirstDate = (day, week) => {
            const startDate = parseDateInput(startDateStr);
            startDate.setDate(startDate.getDate() + (week - 1) * 7 + (day - 1));
            return formatDateForIcs(startDate);
        };

        const courseBlocks = document.querySelectorAll(".arrage");
        log(`在页面上找到了 ${courseBlocks.length} 个 <div class="arrage"> 课程块，现在开始筛选并处理...`);
        const classes = [];

        for (const block of courseBlocks) {
            const td = block.closest('td');
            if (!td || td.style.display === 'none') {
                continue;
            }

            const jcVal = td.getAttribute("jc");
            const xqVal = td.getAttribute("xq");
            const rowspanVal = td.getAttribute("rowspan") || "1";

            if (DEBUG) console.groupCollapsed(`[处理课程] 星期: ${xqVal}, 起始节次: ${jcVal}, 跨度: ${rowspanVal}节`);

            try {
                const courseInfoDivs = block.querySelectorAll('div');
                if (courseInfoDivs.length < 4) { log("信息不全，跳过。"); continue; }

                const weeksText = courseInfoDivs[0]?.textContent.trim();
                const summary = courseInfoDivs[1]?.textContent.replace(/\(.*?\)/g, '').trim();
                const description = courseInfoDivs[2]?.textContent.trim();
                const location = courseInfoDivs[3]?.textContent.replace(/（.*?）/g, '').trim();

                if (!weeksText || !summary) { log("缺少周次或课程名，跳过。"); continue; }

                const weeksMatch = weeksText.match(/(\d+)-(\d+)(单|双)?周/);
                if (!weeksMatch) { log("周次格式不匹配，跳过。"); continue; }

                const [, startWeekStr, endWeekStr, weekType] = weeksMatch;
                const startWeek = parseInt(startWeekStr, 10), endWeek = parseInt(endWeekStr, 10);

                let weekCount, interval;
                if (weekType === "单" || weekType === "双") {
                    let count = 0; const isOdd = weekType === "单";
                    for (let i = startWeek; i <= endWeek; i++) if ((isOdd && i % 2 !== 0) || (!isOdd && i % 2 === 0)) count++;
                    weekCount = count; interval = ";INTERVAL=2";
                } else {
                    weekCount = endWeek - startWeek + 1; interval = "";
                }
                if (weekCount <= 0) { log("计算出的上课周数为0，跳过。"); continue; }

                const jc = parseInt(jcVal, 10), day = parseInt(xqVal, 10), duration = parseInt(rowspanVal, 10);
                let firstWeek = startWeek;
                if ((weekType === '单' && startWeek % 2 === 0) || (weekType === '双' && startWeek % 2 !== 0)) {
                    firstWeek = startWeek + 1;
                }

                const date = getFirstDate(day, firstWeek);
                const start = getStartTime(jc);
                const end = getEndTime(jc, duration);
                if (!start || !end) { log(`无法计算时间(jc:${jc}, dur:${duration})，跳过。`); continue; }

                // --- 生成提醒组件 ---
                const alarms = REMINDER_MINUTES.map(minute => {
                    return [
                        "BEGIN:VALARM",
                        "ACTION:DISPLAY",
                        `DESCRIPTION:${summary} 即将开始`,
                        `TRIGGER:-PT${minute}M`, // PT = Period of Time, M = Minutes
                        "END:VALARM"
                    ].join('\n');
                }).join('\n');
                if (alarms) log(`已为本课程生成 ${REMINDER_MINUTES.length} 个提醒。`);
                // --- 提醒组件结束 ---

                const eventParts = [
                    "BEGIN:VEVENT",
                    `SUMMARY:${summary}`,
                    `DESCRIPTION:${description}`,
                    `DTSTART;TZID=Asia/Shanghai:${date}T${start}`,
                    `DTEND;TZID=Asia/Shanghai:${date}T${end}`,
                    `LOCATION:${location}`,
                    `RRULE:FREQ=WEEKLY;COUNT=${weekCount}${interval}`
                ];

                if (alarms) {
                    eventParts.push(alarms);
                }

                eventParts.push("END:VEVENT");

                classes.push(eventParts.join('\n'));
                log("成功生成 VEVENT 事件。");

            } catch (error) {
                console.error(`[课表助手] 处理课程块时发生错误:`, error, block);
            } finally {
                if (DEBUG) console.groupEnd();
            }
        }

        log(`===== 处理完成，共生成了 ${classes.length} 个课程事件 =====`);

        if (classes.length === 0) {
            alert("未找到任何有效的课程信息！请按 F12 查看控制台中的日志以排查问题。");
            return;
        }

        const textContent = [...HEADERS, ...classes, ...FOOTERS].join('\n');
        const blob = new Blob([textContent], { type: 'text/calendar;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url; a.download = `schedule_${new Date().toISOString().slice(0, 10)}.ics`;
        document.body.appendChild(a); a.click();
        URL.revokeObjectURL(url); document.body.removeChild(a);
        log("ICS文件已生成并触发下载。");
    }
})();
