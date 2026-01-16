import { Query } from "@/app/generated/prisma";
import { DeleteAlert } from "@/components/common";

interface Props {
  query: Query;
  triggerButton: React.ReactNode;
}

const QueryDeleteAlert = ({ query, triggerButton }: Props) => {
  return (
    <DeleteAlert
      item={query}
      itemName="name"
      title="Delete Query"
      description={(item) =>
        `Are you sure you want to delete the query "${item.name}"? This action cannot be undone.`
      }
      deleteEndpoint={(id) => `/api/follow/queries/${id}`}
      queryKeys={[["queries"]]}
      triggerButton={triggerButton}
    />
  );
};

export default QueryDeleteAlert;
