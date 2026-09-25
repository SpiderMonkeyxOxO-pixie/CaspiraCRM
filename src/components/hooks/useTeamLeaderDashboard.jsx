// useTeamLeaderDashboard.js - FIXED WITH DIFFERENT QUOTA TARGETS
import { useState, useCallback, useEffect } from "react";
import { useSelector } from "react-redux";

const formatCompactNumber = (num, decimals = 1) => {
    if (typeof num !== "number" || isNaN(num)) return "0";
    const abs = Math.abs(num);
    const sign = num < 0 ? "-" : "";
    if (abs >= 1e9) return sign + (abs / 1e9).toFixed(decimals) + "B";
    if (abs >= 1e6) return sign + (abs / 1e6).toFixed(decimals) + "M";
    if (abs >= 1e3) return sign + (abs / 1e3).toFixed(decimals) + "K";
    return sign + abs.toString();
};

const safeDivide = (a, b, fallback = 0) => (b > 0 ? a / b : fallback);

export const useTeamLeaderDashboard = () => {
    const [isInitialized, setIsInitialized] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [timeFilter, setTimeFilter] = useState("daily");

    const [dashboardData, setDashboardData] = useState({
        totalCases: 0,
        activeAgents: 0,
        avgResponseTime: 0,
        successRate: 0,
        csrQuota: { met: 0, nonMet: 100 },
        depositQuota: { met: 0, nonMet: 100 },
        withdrawalQuota: { met: 0, nonMet: 100 },
        totalConversations: 0,
        totalTransactions: 0,
        positiveRate: 0,
        firstResponseTime: 0,
        quotaDetails: {
            metCount: 0,
            nonMetCount: 0,
            totalAgents: 0,
            quotaTarget: 0 // Add quota target to dashboard data
        }
    });

    const [, setTeamLeaderStats] = useState([]);
    const [filteredStats, setFilteredStats] = useState([]);
    const [shiftChartData, setShiftChartData] = useState({});
    const [quotaManagementData, setQuotaManagementData] = useState([]);

    const { data, loading: combinedQuotaLoading } = useSelector(
        (state) => state.combinedQuota
    );
    const { department } = useSelector((state) => state.auth?.data || {});


    const calculateQuotaStats = (agentPerformance, departmentType = '') => {


        let quotaTarget = 1500;

        if (departmentType === 'CSR') {
            quotaTarget = 500;
        } else if (departmentType === 'Deposit') {
            quotaTarget = 500;
        } else if (departmentType === 'Withdrawal') {
            quotaTarget = 1500;
        }


        if (!agentPerformance || !Array.isArray(agentPerformance) || agentPerformance.length === 0) {

            return {
                met: 0,
                nonMet: 100,
                metCount: 0,
                nonMetCount: 0,
                totalAgents: 0,
                quotaTarget: quotaTarget
            };
        }

        const totalAgents = agentPerformance.length;

        // Detailed analysis of each agent's transaction count
        const agentAnalysis = agentPerformance.map(agent => {
            const transactions = agent.transactions || agent.withdrawals || agent.completed || 0;
            const meetsQuota = transactions >= quotaTarget;
            return {
                name: agent.name,
                transactions: transactions,
                meetsQuota: meetsQuota
            };
        });

        // Count agents meeting quota
        const metCount = agentAnalysis.filter(agent => agent.meetsQuota).length;
        const nonMetCount = totalAgents - metCount;

        // Calculate percentages with proper rounding
        const metPercentage = totalAgents > 0 ? Math.round((metCount / totalAgents) * 100) : 0;
        const nonMetPercentage = 100 - metPercentage;

        return {
            met: metPercentage,
            nonMet: nonMetPercentage,
            metCount: metCount,
            nonMetCount: nonMetCount,
            totalAgents: totalAgents,
            quotaTarget: quotaTarget
        };
    };

    const parseTimeToSeconds = (timeStr) => {
        if (!timeStr || typeof timeStr !== "string") return 0;
        const parts = timeStr.split(":").map((p) => parseInt(p, 10) || 0);
        return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
    };

    const parsePercentage = (str) => {
        if (!str || typeof str !== "string") return 0;
        return parseFloat(str.replace("%", "").trim()) || 0;
    };

    const calculateFilteredValues = (baseValue, filter) => {
        const multipliers = { daily: 1, weekly: 7, monthly: 30 };
        return Math.round(baseValue * (multipliers[filter] || 1));
    };

    const generateFilteredSparkline = (base, variation = 0.2, filter) => {
        const length = filter === "daily" ? 24 : filter === "weekly" ? 7 : 30;
        return Array.from({ length }, () =>
            Math.max(0, Math.round(base * (1 + Math.random() * variation * 2 - variation)))
        );
    };

    // FIXED SHIFT CHART DATA (keep your existing function)
    const generateShiftChartData = (totalValue, filter) => {
        const morning = Math.round(totalValue * 0.4);
        const night = Math.round(totalValue * 0.35);
        const rand = (v) => Math.round(v * (0.7 + Math.random() * 0.6));

        if (filter === "daily") {
            const data = {
                labels: ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00", "23:59"],
                datasets: [
                    {
                        label: "Morning Shift (4AM-4PM)",
                        data: [
                            rand(morning * 0.1),
                            rand(morning * 0.3),
                            rand(morning * 0.8),
                            rand(morning * 1.0),
                            rand(morning * 0.6),
                            rand(morning * 0.2),
                            rand(morning * 0.05),
                        ],
                        borderColor: "rgb(59, 130, 246)",
                        backgroundColor: "rgba(59, 130, 246, 0.2)",
                        tension: 0.4,
                        fill: true,
                    },
                    {
                        label: "Night Shift (4PM-4AM)",
                        data: [
                            rand(night * 0.6),
                            rand(night * 0.8),
                            rand(night * 0.3),
                            rand(night * 0.1),
                            rand(night * 0.2),
                            rand(night * 0.7),
                            rand(night * 1.0),
                        ],
                        borderColor: "rgb(168, 85, 247)",
                        backgroundColor: "rgba(168, 85, 247, 0.2)",
                        tension: 0.4,
                        fill: true,
                    },
                ],
            };
            setShiftChartData(data);
            return data;
        }

        const days = filter === "weekly" ? 7 : 4;
        const labels = filter === "weekly"
            ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
            : ["Week 1", "Week 2", "Week 3", "Week 4"];

        const data = {
            labels,
            datasets: [
                {
                    label: "Morning Shift",
                    data: Array.from({ length: days }, () => rand(morning)),
                    borderColor: "rgb(59, 130, 246)",
                    backgroundColor: "rgba(59, 130, 246, 0.2)",
                    tension: 0.4,
                    fill: true,
                },
                {
                    label: "Night Shift",
                    data: Array.from({ length: days }, () => rand(night)),
                    borderColor: "rgb(168, 85, 247)",
                    backgroundColor: "rgba(168, 85, 247, 0.2)",
                    tension: 0.4,
                    fill: true,
                },
            ],
        };
        setShiftChartData(data);
        return data;
    };

    // FIXED QUOTA MANAGEMENT DATA (keep your existing function)
    const generateQuotaManagementData = (totalValue, filter, activeAgents, agentPerformance = []) => {
        const agents = activeAgents.length > 0 ? activeAgents : ["No agents"];
        const multiplier = { daily: 1, weekly: 7, monthly: 30 }[filter] || 1;
        const baseQuota = agents.length > 0 ? Math.round(totalValue / agents.length / multiplier) : 0;

        const quotaData = agents.map((agent) => {
            const agentPerf = agentPerformance.find(ap => ap.name === agent);
            let variance = 0.7 + Math.random() * 0.5;

            if (agentPerf) {
                variance = agentPerf.efficiency / 100 || variance;
            }

            const achieved = Math.round(baseQuota * variance * multiplier);
            const quota = Math.round(baseQuota * multiplier);
            const performance = quota > 0 ? Math.min(100, Math.round((achieved / quota) * 100)) : 0;

            return {
                agent,
                quota,
                achieved,
                performance
            };
        });

        setQuotaManagementData(quotaData);
        return quotaData;
    };

    // FIXED CSR DATA PROCESSING WITH 500 QUOTA
    const processCSRDataForTeamLeader = useCallback(
        (apiData, filter = "daily") => {
            if (!apiData || !Array.isArray(apiData)) {
                console.log("❌ No API data available");
                return { stats: [], agents: [] };
            }

            let totalCompleted = 0;
            let totalPosRate = 0;
            let totalFirstRespSec = 0;
            let frtCount = 0;
            let agentCount = 0;

            const activeAgents = [];
            const agentPerformance = [];

            apiData.forEach((row) => {
                if (!Array.isArray(row) || row.length < 9) return;

                const type = row[0]?.toString().trim();
                const name = row[2]?.toString().trim();

                if (
                    type === "CSR" &&
                    name &&
                    !name.includes("Morning shift") &&
                    !name.includes("Night shift") &&
                    !name.includes("HIGHLIGHTS") &&
                    !name.includes("HALF DATA") &&
                    !name.includes("FAILED") &&
                    !name.includes("ASSIGNED") &&
                    !name.includes("REACHED") &&
                    !name.includes("SENIOR") &&
                    name !== "11/13" &&
                    name !== "" &&
                    name !== "Ave. Completed Convo" &&
                    name !== "Ave. Online time"
                ) {
                    const completed = parseInt(row[3], 10) || 0;
                    const effective = parseInt(row[4], 10) || 0;
                    const frtStr = row[7]?.toString().trim() || "00:00:00";
                    const posStr = row[8]?.toString().trim() || "0%";

                    if (frtStr.includes(":")) {
                        const frtSec = parseTimeToSeconds(frtStr);
                        if (frtSec > 3000 && frtSec < 45000) {
                            totalFirstRespSec += frtSec;
                            frtCount++;
                        }
                    }

                    if (completed > 0) {
                        totalCompleted += completed;
                        totalPosRate += parsePercentage(posStr);
                        agentCount++;

                        activeAgents.push(name);
                        agentPerformance.push({
                            name,
                            transactions: completed, // Use completed as transaction count for quota
                            completed,
                            effective,
                            firstResponseTime: parseTimeToSeconds(frtStr),
                            positiveRate: parsePercentage(posStr),
                            efficiency: completed > 0 ? (effective / completed) * 100 : 0
                        });
                    }
                }
            });

            const avgFirstRespSec = frtCount > 0 ? totalFirstRespSec / frtCount : 0;
            const avgHours = Math.floor(avgFirstRespSec / 3600);
            const avgMinutes = Math.floor((avgFirstRespSec % 3600) / 60);
            const avgSeconds = Math.floor(avgFirstRespSec % 60);

            const averageOnlineTime =
                `${String(avgHours).padStart(2, "0")}:` +
                `${String(avgMinutes).padStart(2, "0")}:` +
                `${String(avgSeconds).padStart(2, "0")}`;

            const avgPosRate = safeDivide(totalPosRate, agentCount);
            const filteredConvo = calculateFilteredValues(totalCompleted, filter);

            // CALCULATE QUOTA BASED ON TRANSACTIONS >= 500 (CSR QUOTA)
            const quotaStats = calculateQuotaStats(agentPerformance, 'CSR');



            const stats = [
                {
                    title: "Total Conversations",
                    value: formatCompactNumber(filteredConvo),
                    interval: filter === "daily" ? "Today" : filter === "weekly" ? "This week" : "This month",
                    trend: filteredConvo > 1000 ? "up" : filteredConvo > 500 ? "neutral" : "down",
                    data: generateFilteredSparkline(filteredConvo, 0.3, filter),
                    difference: formatCompactNumber(filteredConvo),
                    role: "teamLeader",
                },
                {
                    title: "Positive Rate",
                    value: `${avgPosRate.toFixed(1)}%`,
                    interval: "Team average",
                    trend: avgPosRate > 80 ? "up" : avgPosRate > 60 ? "neutral" : "down",
                    data: generateFilteredSparkline(avgPosRate, 0.1, filter),
                    difference: `${avgPosRate.toFixed(1)}%`,
                    role: "teamLeader",
                },
                {
                    title: "Average Online Time",
                    value: averageOnlineTime,
                    interval: "Avg per agent",
                    trend: avgFirstRespSec < 40000 ? "up" : "down",
                    data: generateFilteredSparkline(avgFirstRespSec / 60, 0.2, filter),
                    difference: averageOnlineTime,
                    role: "teamLeader",
                },
            ];

            setDashboardData((prev) => ({
                ...prev,
                totalCases: filteredConvo,
                activeAgents: agentCount,
                avgResponseTime: averageOnlineTime,
                positiveRate: avgPosRate,
                firstResponseTime: averageOnlineTime,
                csrQuota: {
                    met: quotaStats.met,
                    nonMet: quotaStats.nonMet
                },
                quotaDetails: {
                    metCount: quotaStats.metCount,
                    nonMetCount: quotaStats.nonMetCount,
                    totalAgents: quotaStats.totalAgents,
                    quotaTarget: quotaStats.quotaTarget // Store the target
                }
            }));

            setQuotaManagementData(
                generateQuotaManagementData(filteredConvo, filter, activeAgents, agentPerformance)
            );

            setShiftChartData(generateShiftChartData(filteredConvo, filter));

            return { stats, agents: activeAgents };
        },
        []
    );

    // FIXED DEPOSIT DATA PROCESSING WITH 500 QUOTA
    const processDepositDataForTeamLeader = useCallback(
        (apiData, filter = "daily") => {
            if (!apiData || !Array.isArray(apiData)) return { stats: [], agents: [] };

            let totalTx = 0;
            let totalSuccess = 0;
            const activeAgents = [];
            const agentPerformance = [];

            console.log("🔍 PROCESSING DEPOSIT DATA WITH ROW[9]...");

            apiData.forEach((row) => {
                if (!Array.isArray(row) || row.length < 10) return; // Changed to 10 for row[9]

                const type = row[0]?.toString().trim();
                const name = row[2]?.toString().trim();

                if (type === "Deposit" && name && name !== "Member" &&
                    !name.includes("Morning") && !name.includes("Night") &&
                    !name.includes("Total") && name !== "9 HOURS" && name !== "12 Hours") {

                    // Using row[9] for transaction count as requested
                    const tx = parseInt(row[9], 10) || 0;
                    const success = parseInt(row[3], 10) || 0;

                    console.log(`📊 Deposit Row - Name: ${name}, Row[9] Transactions: ${tx}, Row[3] Success: ${success}`);

                    if (tx > 0) {
                        totalTx += tx;
                        totalSuccess += success;
                        if (!activeAgents.includes(name)) {
                            activeAgents.push(name);
                            agentPerformance.push({
                                name,
                                transactions: tx, // Using row[9] data for quota calculation
                                successful: success,
                                successRate: tx > 0 ? (success / tx) * 100 : 0
                            });

                            console.log(`👤 Deposit Agent Added: ${name}, Transactions: ${tx}`);
                        }
                    }
                }
            });

            console.log(`📊 Deposit Final - Total Agents: ${activeAgents.length}, Total Transactions: ${totalTx}`);

            const agentCount = activeAgents.length;
            const successRate = totalTx > 0 ? safeDivide(totalSuccess, totalTx) * 100 : 0;
            const baseDaily = totalTx;
            const filteredTx = calculateFilteredValues(baseDaily, filter);
            const filteredRate = Math.min(100, successRate);

            // CALCULATE QUOTA BASED ON TRANSACTIONS >= 500 (DEPOSIT QUOTA)
            const quotaStats = calculateQuotaStats(agentPerformance, 'Deposit');

            console.log("📊 DEPOSIT QUOTA DEBUG (Target: 500, Using Row[9]):");
            console.log("Total Agents:", quotaStats.totalAgents);
            console.log("Agents Met Quota (>=500):", quotaStats.metCount);
            console.log("Quota Met %:", quotaStats.met);
            console.log("Quota Not Met %:", quotaStats.nonMet);
            console.log("Agent Performance Data:", agentPerformance);

            const stats = [
                {
                    title: "Total Transactions",
                    value: formatCompactNumber(filteredTx),
                    interval: filter === "daily" ? "Today" : filter === "weekly" ? "This week" : "This month",
                    trend: successRate > 80 ? "up" : successRate > 60 ? "neutral" : "down",
                    data: generateFilteredSparkline(filteredTx / (filter === "daily" ? 24 : filter === "weekly" ? 7 : 30), 0.3, filter),
                    difference: formatCompactNumber(filteredTx),
                    role: "teamLeader",
                },
                {
                    title: "Success Rate",
                    value: `${filteredRate.toFixed(1)}%`,
                    interval: "Transaction success rate",
                    trend: filteredRate > 80 ? "up" : filteredRate > 70 ? "neutral" : "down",
                    data: generateFilteredSparkline(filteredRate, 0.1, filter),
                    difference: `${filteredRate.toFixed(1)}%`,
                    role: "teamLeader",
                },
                {
                    title: "Active Agents",
                    value: agentCount,
                    interval: "Processing transactions",
                    trend: agentCount > 0 ? "up" : "neutral",
                    data: generateFilteredSparkline(agentCount, 0.1, filter),
                    difference: `${agentCount}`,
                    role: "teamLeader",
                },
            ];

            setDashboardData((prev) => ({
                ...prev,
                totalTransactions: filteredTx,
                activeAgents: agentCount,
                successRate: filteredRate,
                depositQuota: {
                    met: quotaStats.met,
                    nonMet: quotaStats.nonMet
                },
                quotaDetails: {
                    metCount: quotaStats.metCount,
                    nonMetCount: quotaStats.nonMetCount,
                    totalAgents: quotaStats.totalAgents,
                    quotaTarget: quotaStats.quotaTarget
                }
            }));

            const quotaData = generateQuotaManagementData(filteredTx, filter, activeAgents, agentPerformance);
            setQuotaManagementData(quotaData);

            const shiftData = generateShiftChartData(filteredTx, filter);
            setShiftChartData(shiftData);

            return { stats, agents: activeAgents };
        },
        []
    );
    // FIXED WITHDRAWAL DATA PROCESSING WITH 1500 QUOTA
    const processWithdrawalDataForTeamLeader = useCallback(
        (apiData, filter = "daily") => {
            if (!apiData || !Array.isArray(apiData)) return { stats: [], agents: [] };

            let totalWd = 0;
            let totalComp = 0;
            const activeAgents = [];
            const agentPerformance = [];
            let totalValueOfIndex3 = 0;
            let totalValueOfIndex4 = 0;

            apiData.forEach((row) => {
                if (!Array.isArray(row) || row.length < 6) return;

                const type = row[0]?.toString().trim();
                const name = row[2]?.toString().trim();

                if ((type === "Withdrawal" || type === "Withdraw") &&
                    name && name !== "Member" &&
                    !name.toLowerCase().includes("shift") &&
                    !name.includes("TOTAL") && !name.includes("AutoDraw")) {

                    const total = parseInt(row[7]?.toString().replace(/,/g, ''), 10) || parseInt(row[3], 10) || 0;
                    const comp = parseInt(row[2], 10) || 0;

                    const value = parseInt(row[3]?.toString().replace(/,/g, ''), 10) || 0;
                    totalValueOfIndex3 += value;

                    const value4 = parseInt(row[4]?.toString().replace(/,/g, ''), 10) || 0;
                    totalValueOfIndex4 += value4;

                    if (total > 0) {
                        totalWd += total;
                        totalComp += comp;
                        if (!activeAgents.includes(name)) {
                            activeAgents.push(name);
                            agentPerformance.push({
                                name,
                                transactions: total, // Use total for quota calculation
                                withdrawals: total,
                                completed: comp,
                                completionRate: total > 0 ? (comp / total) * 100 : 0
                            });
                        }
                    }
                }
            });

            const agentCount = activeAgents.length;
            const successRate = totalWd > 0 ? safeDivide(totalComp, totalWd) * 100 : 0;
            const baseDaily = totalWd;
            const filteredWd = calculateFilteredValues(baseDaily, filter);
            const filteredRate = Math.min(100, successRate);

            // CALCULATE QUOTA BASED ON TRANSACTIONS >= 1500 (WITHDRAWAL QUOTA)
            const quotaStats = calculateQuotaStats(agentPerformance, 'Withdrawal');

            console.log("📊 WITHDRAWAL QUOTA DEBUG (Target: 1500):");
            console.log("Total Agents:", quotaStats.totalAgents);
            console.log("Agents Met Quota (>=1500):", quotaStats.metCount);
            console.log("Quota Met %:", quotaStats.met);
            console.log("Quota Not Met %:", quotaStats.nonMet);

            const stats = [
                {
                    title: "Total Transaction Process",
                    value: formatCompactNumber(filteredWd).toLocaleString("en-IN"),
                    interval: filter === "daily" ? "Today" : filter === "weekly" ? "This week" : "This month",
                    trend: successRate > 80 ? "up" : successRate > 65 ? "neutral" : "down",
                    data: generateFilteredSparkline(
                        filteredWd / (filter === "daily" ? 24 : filter === "weekly" ? 7 : 30),
                        0.3,
                        filter
                    ),
                    difference: filteredWd.toLocaleString("en-IN"),
                    role: "teamLeader",
                },
                {
                    title: "Total Transaction Passed",
                    value: `${filteredRate.toLocaleString("en-IN")}%`,
                    interval: "Completion rate",
                    trend: filteredRate > 80 ? "up" : filteredRate > 70 ? "neutral" : "down",
                    data: generateFilteredSparkline(totalValueOfIndex3, 0.4, filter),
                    difference: totalValueOfIndex3.toLocaleString("en-IN"),
                    role: "teamLeader",
                },
                {
                    title: "Total Amount Passed",
                    value: agentCount.toLocaleString("en-IN"),
                    interval: "Processing withdrawals",
                    trend: agentCount > 0 ? "up" : "neutral",
                    data: generateFilteredSparkline(totalValueOfIndex4, 2, filter),
                    difference: totalValueOfIndex4.toLocaleString("en-IN"),
                    role: "teamLeader",
                },
            ];


            setDashboardData((prev) => ({
                ...prev,
                totalTransactions: filteredWd,
                activeAgents: agentCount,
                successRate: filteredRate,
                withdrawalQuota: {
                    met: quotaStats.met,
                    nonMet: quotaStats.nonMet
                },
                quotaDetails: {
                    metCount: quotaStats.metCount,
                    nonMetCount: quotaStats.nonMetCount,
                    totalAgents: quotaStats.totalAgents,
                    quotaTarget: quotaStats.quotaTarget // Store the target
                }
            }));

            const quotaData = generateQuotaManagementData(filteredWd, filter, activeAgents, agentPerformance);
            setQuotaManagementData(quotaData);

            const shiftData = generateShiftChartData(filteredWd, filter);
            setShiftChartData(shiftData);

            return { stats, agents: activeAgents };
        },
        []
    );

    // Rest of your existing code remains the same...
    const processRealData = useCallback(
        (apiData, userDept, filter = "daily") => {
            if (!apiData || !userDept) {
                console.log("❌ Missing data or department");
                return;
            }

            let result = { stats: [], agents: [] };

            if (userDept === "CSR") {
                result = processCSRDataForTeamLeader(apiData, filter);
            } else if (userDept === "Deposit") {
                result = processDepositDataForTeamLeader(apiData, filter);
            } else if (userDept === "Withdrawal" || userDept === "Withdraw") {
                result = processWithdrawalDataForTeamLeader(apiData, filter);
            } else {
                console.log("⚠️ Unknown department:", userDept);
                const base = calculateFilteredValues(100, filter);
                result.stats = [
                    {
                        title: "Total Activity",
                        value: formatCompactNumber(base),
                        interval: filter === "daily" ? "Today" : filter === "weekly" ? "This week" : "This month",
                        trend: "neutral",
                        data: generateFilteredSparkline(base / (filter === "daily" ? 24 : filter === "weekly" ? 7 : 30), 0.3, filter),
                        difference: formatCompactNumber(base),
                        role: "teamLeader",
                    },
                ];
            }

            setTeamLeaderStats(result.stats);
            setFilteredStats(result.stats);
        },
        [
            processCSRDataForTeamLeader,
            processDepositDataForTeamLeader,
            processWithdrawalDataForTeamLeader,
        ]
    );

    useEffect(() => {
        if (data && data.length > 0 && department) {
            processRealData(data, department, timeFilter);
        }
    }, [timeFilter, data, department, processRealData]);

    return {
        dashboardData,
        teamLeaderStats: filteredStats,
        filteredStats,
        isInitialized,
        isRefreshing,
        combinedQuotaLoading,
        department,
        processRealData,
        setIsInitialized,
        setIsRefreshing,
        timeFilter,
        setTimeFilter,
        shiftChartData,
        quotaManagementData,
    };
};