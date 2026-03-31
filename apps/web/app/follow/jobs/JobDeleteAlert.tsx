import { DeleteAlert } from "@/components/common";
import { JobWithAggregations } from "@/lib/types";

interface Props {
  job: JobWithAggregations;
  triggerButton: React.ReactNode;
}

const JobDeleteAlert = ({ job, triggerButton }: Props) => {
  return (
    <DeleteAlert
      item={job}
      itemName="name"
      title="Delete Job"
      description={(item) =>
        `Are you sure you want to delete the job "${item.name}"? This action cannot be undone.`
      }
      deleteEndpoint={(id) => `/api/follow/jobs/${id}`}
      queryKeys={[["jobs"]]}
      triggerButton={triggerButton}
    />
  );
};

export default JobDeleteAlert;
