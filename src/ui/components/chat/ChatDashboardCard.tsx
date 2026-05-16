import { FileDown } from 'lucide-react';
import { Button } from '../Button';
import { Card } from '../Card';

interface ChatDashboardMetric {
    label: string;
    value: string;
    change: string;
    trend: 'up' | 'down';
}

interface ChatDashboardData {
    title: string;
    metrics: ChatDashboardMetric[];
}

interface ChatDashboardCardProps {
    messageId: string;
    dashboard: ChatDashboardData;
    onExport: (messageId: string, title: string) => void;
}

export function ChatDashboardCard({ messageId, dashboard, onExport }: ChatDashboardCardProps) {
    return (
        <div className="mb-4 w-full" id={`dashboard-${messageId}`}>
            <Card padding="md">
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold">{dashboard.title}</h3>
                        <Button variant="icon" iconOnly size="sm" onClick={() => onExport(messageId, dashboard.title)} title="Download as PDF">
                            <FileDown className="h-4 w-4" />
                        </Button>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        {dashboard.metrics.map((metric, index) => (
                            <div key={index} className="rounded-lg border border-border bg-secondary/30 p-4 dark:border-[#2a2a2a] dark:bg-[#2a2a2a]/50">
                                <div className="mb-1 text-sm text-muted-foreground dark:text-gray-400">{metric.label}</div>
                                <div className="mb-1 text-2xl font-bold dark:text-gray-100">{metric.value}</div>
                                <div className={`text-sm ${metric.trend === 'up' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{metric.change}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </Card>
        </div>
    );
}
