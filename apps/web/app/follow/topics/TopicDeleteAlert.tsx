import { DeleteAlert } from "@/components/common";
import { TopicWithAggregations } from "@/lib/types";

interface Props {
  topic: TopicWithAggregations;
  triggerButton: React.ReactNode;
}

const TopicDeleteAlert = ({ topic, triggerButton }: Props) => {
  return (
    <DeleteAlert
      item={topic}
      itemName="name"
      title="Delete Topic"
      description={(item) =>
        `Are you sure you want to delete the topic "${item.name}"? This action cannot be undone.`
      }
      deleteEndpoint={(id) => `/api/follow/topics/${id}`}
      queryKeys={[["topics"]]}
      triggerButton={triggerButton}
    />
  );
};

export default TopicDeleteAlert;
