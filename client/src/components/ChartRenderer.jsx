import { useEffect } from 'react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement, ArcElement,
  Title, Tooltip, Legend,
} from 'chart.js';
import { Bar, Line, Pie, Doughnut } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement, ArcElement,
  Title, Tooltip, Legend
);

const COLORS = [
  '#cc6b4a', '#4ade80', '#3b82f6', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f43f5e', '#a78bfa',
];

const CHART_COMPONENTS = {
  bar: Bar,
  line: Line,
  pie: Pie,
  doughnut: Doughnut,
};

const defaultOptions = {
  responsive: true,
  maintainAspectRatio: true,
  plugins: {
    legend: {
      labels: { color: '#e8e8e0', font: { family: 'Inter', size: 12 } },
    },
    title: {
      display: false,
    },
    tooltip: {
      backgroundColor: '#2a2a2a',
      titleColor: '#e8e8e0',
      bodyColor: '#e8e8e0',
      borderColor: 'rgba(255,255,255,0.1)',
      borderWidth: 1,
    },
  },
  scales: {
    x: {
      ticks: { color: '#888880', font: { family: 'Inter', size: 11 } },
      grid: { color: 'rgba(255,255,255,0.05)' },
    },
    y: {
      ticks: { color: '#888880', font: { family: 'Inter', size: 11 } },
      grid: { color: 'rgba(255,255,255,0.05)' },
    },
  },
};

function buildChartData(chartSpec) {
  const { labels, datasets, type } = chartSpec;
  const isPieType = type === 'pie' || type === 'doughnut';

  return {
    labels,
    datasets: datasets.map((ds, i) => ({
      label: ds.label || '',
      data: ds.data,
      backgroundColor: isPieType
        ? COLORS.slice(0, labels.length)
        : ds.color || COLORS[i % COLORS.length],
      borderColor: isPieType
        ? '#1a1a1a'
        : ds.color || COLORS[i % COLORS.length],
      borderWidth: isPieType ? 2 : 2,
      tension: type === 'line' ? 0.3 : undefined,
      fill: type === 'line' ? false : undefined,
    })),
  };
}

function getOptions(chartSpec) {
  const isPieType = chartSpec.type === 'pie' || chartSpec.type === 'doughnut';
  const opts = {
    ...defaultOptions,
    plugins: {
      ...defaultOptions.plugins,
      title: {
        display: !!chartSpec.title,
        text: chartSpec.title || '',
        color: '#e8e8e0',
        font: { family: 'Inter', size: 14, weight: 500 },
      },
    },
  };

  if (isPieType) {
    delete opts.scales;
  }

  return opts;
}

export default function ChartRenderer({ chartSpec }) {
  const ChartComponent = CHART_COMPONENTS[chartSpec.type] || Bar;
  const data = buildChartData(chartSpec);
  const options = getOptions(chartSpec);

  return (
    <div className="chart-container">
      <ChartComponent data={data} options={options} />
    </div>
  );
}
