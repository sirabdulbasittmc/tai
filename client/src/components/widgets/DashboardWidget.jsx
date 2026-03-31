import SalesDashboard from './SalesDashboard';
import ProjectDashboard from './ProjectDashboard';
import RiskDashboard from './RiskDashboard';
import PipelineDashboard from './PipelineDashboard';
import EmployeeDashboard from './EmployeeDashboard';

export default function DashboardWidget({ data }) {
  if (!data?.widget_type) return null;

  switch (data.widget_type) {
    case 'sales_dashboard':
      return <SalesDashboard data={data} />;
    case 'project_dashboard':
      return <ProjectDashboard data={data} />;
    case 'risk_dashboard':
      return <RiskDashboard data={data} />;
    case 'pipeline_dashboard':
      return <PipelineDashboard data={data} />;
    case 'employee_dashboard':
      return <EmployeeDashboard data={data} />;
    default:
      return null;
  }
}
