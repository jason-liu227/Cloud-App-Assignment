import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { actorKey, ddb, movieKey, type Role, tableName } from "../shared/db";
import { isResponse, parseJsonObject, response } from "../shared/http";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  
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
    typeof body.movieId !== "number" ||
    !Number.isSafeInteger(body.movieId) ||
    body.movieId <= 0 ||
    typeof body.actorId !== "number" ||
    !Number.isSafeInteger(body.actorId) ||
    body.actorId <= 0 ||
    typeof body.roleName !== "string" ||
    body.roleName.trim() === "" ||
    typeof body.roleDescription !== "string" ||
    body.roleDescription.trim() === ""
  ) {
    return response(400, {
      message: "Missing or invalid role fields"
    });
  }

  const role: Role = {
    movieId: body.movieId as number,
    actorId: body.actorId as number,
    roleName: body.roleName as string,
    roleDescription: body.roleDescription as string,
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
      return response(409, {
        message: "Movie or actor not found, or role already exists"
      });
    }

    return response(500, {
      message: "Internal server error"
    });
  }
};
