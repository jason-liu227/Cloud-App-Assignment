import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { actorKey, ddb, movieKey, type Role, tableName } from "../shared/db";
import { isResponse, parseJsonObject, response } from "../shared/http";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  
const isValidId = (value: unknown): value is number => {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  );
};

const isValidText = (value: unknown): value is string => {
  return typeof value === "string" && value.trim() !== "";
};
  
  console.log("Username:", "API key user");
  console.log("Request path:", event.path);

  const body = parseJsonObject(event);
  if (isResponse(body)) return body;
  
  const allowedFields = [
    "movieId",
    "actorId",
    "roleName",
    "roleDescription"
  ];

  for (const field of Object.keys(body)) {
    if (!allowedFields.includes(field)) {
      return response(400, {
        message: "Unexpected field: " + field
      });
    }
  }

  if (
  !isValidId(body.movieId) ||
  !isValidId(body.actorId) ||
  !isValidText(body.roleName) ||
  !isValidText(body.roleDescription)
  ) {
    return response(400, {
      message: "Missing or invalid role fields"
    });
  }

  const role: Role = {
    movieId: body.movieId,
    actorId: body.actorId,
    roleName: body.roleName,
    roleDescription: body.roleDescription,
  };

  try {

    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            ConditionCheck: {
              TableName: tableName,
              Key: {
                PK: movieKey(role.movieId),
                SK: movieKey(role.movieId)
              },
              ConditionExpression: "attribute_exists(PK)"
            }
          },
          {
            ConditionCheck: {
              TableName: tableName,
              Key: {
                PK: actorKey(role.actorId),
                SK: actorKey(role.actorId)
              },
              ConditionExpression: "attribute_exists(PK)"
            }
          },
          {
            Put: {
              TableName: tableName,
              Item: {
                PK: movieKey(role.movieId),
                SK: actorKey(role.actorId),
                ...role
              },
              ConditionExpression: "attribute_not_exists(PK)"
            }
          }
        ]
      })
    );
    return response(201, { message: "Role added", data: role });
  

  } catch (err) {
    console.error("DynamoDB error:", err);

    if (
      err instanceof Error &&
      err.name === "TransactionCanceledException"
    ) {
      const reasons = (
        err as Error & {
          CancellationReasons?: { Code?: string }[];
        }
      ).CancellationReasons;

      if (reasons?.[0]?.Code === "ConditionalCheckFailed") {
        return response(404, {
          message: "Movie not found"
        });
      }

      if (reasons?.[1]?.Code === "ConditionalCheckFailed") {
        return response(404, {
          message: "Actor not found"
        });
      }

      if (reasons?.[2]?.Code === "ConditionalCheckFailed") {
        return response(409, {
          message: "Role already exists"
        });
      }
    }

    return response(500, {
      message: "Internal server error"
    });
  }
};
