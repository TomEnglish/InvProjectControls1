import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
  Title,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
  Title,
);

ChartJS.defaults.font.family =
  "'Segoe UI', system-ui, -apple-system, sans-serif";
ChartJS.defaults.font.size = 12;
