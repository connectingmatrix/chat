export const LIVE_CHAT_EMAIL = 'rich@gigaintelligence.com';
export const LIVE_CHAT_USER_ID = '38d30c56-2f1d-405e-acc3-fe6a6e96cbc5';
export const LIVE_CHAT_PORT = 3013;
export const LIVE_CHAT_PROMPT = 'Create me channel, category and subject structure for organising the world news by continent and by genre.';

export const CHAT_QUERY = /* GraphQL */ `
  mutation ChatQuery($input: ChatQueryInput!) {
    chatQuery(input: $input) {
      chat {
        id
        created
      }
      answer {
        text
        weak_context
      }
      messages {
        assistant {
          id
          content
        }
      }
      agent {
        intent
        response_format
        requires_confirmation
        interaction
        workflow_cypher
        workflow_validation
        workflow_execution_output
        pending_actions {
          id
          name
          reason
          input
          depends_on
        }
        plan {
          intent
          actions {
            id
            name
            reason
            input
            depends_on
          }
        }
        action_results {
          id
          name
          status
          reason
          summary
          data
          error
          duration_ms
        }
        pipeline_passes {
          kind
          response_format
          plan {
            intent
            actions {
              id
              name
              reason
              input
              depends_on
            }
          }
          action_results {
            id
            name
            status
            summary
          }
        }
      }
    }
  }
`;

export const CHAT_SEND = /* GraphQL */ `
  mutation ChatSend($input: ChatQueryInput!) {
    chatSend(input: $input) {
      chat {
        id
        created
      }
      answer {
        text
        weak_context
      }
      messages {
        assistant {
          id
          content
        }
      }
      agent {
        intent
        response_format
        requires_confirmation
        interaction
        workflow_cypher
        workflow_validation
        workflow_execution_output
        pending_actions {
          id
          name
          reason
          input
          depends_on
        }
        plan {
          intent
          actions {
            id
            name
            reason
            input
            depends_on
          }
        }
        action_results {
          id
          name
          status
          reason
          summary
          data
          error
          duration_ms
        }
        pipeline_passes {
          kind
          response_format
          plan {
            intent
            actions {
              id
              name
              reason
              input
              depends_on
            }
          }
          action_results {
            id
            name
            status
            summary
          }
        }
      }
    }
  }
`;

export const CHAT_CONFIRM = /* GraphQL */ `
  mutation ChatConfirm($input: ChatConfirmInput!) {
    chatConfirm(input: $input) {
      chat {
        id
        created
      }
      answer {
        text
        weak_context
      }
      messages {
        assistant {
          id
          content
        }
      }
      agent {
        intent
        response_format
        requires_confirmation
        interaction
        workflow_cypher
        workflow_validation
        workflow_execution_output
        pending_actions {
          id
          name
          reason
          input
          depends_on
        }
        plan {
          intent
          actions {
            id
            name
            reason
            input
            depends_on
          }
        }
        action_results {
          id
          name
          status
          reason
          summary
          data
          error
          duration_ms
        }
        pipeline_passes {
          kind
          response_format
          plan {
            intent
            actions {
              id
              name
              reason
              input
              depends_on
            }
          }
          action_results {
            id
            name
            status
            summary
          }
        }
      }
    }
  }
`;

export const CHAT_GET_OR_CREATE = /* GraphQL */ `
  mutation GetOrCreateChat($input: GetOrCreateChatInput!) {
    getOrCreateChat(input: $input) {
      id
      title
      scope {
        type
        id
        organizationId
      }
    }
  }
`;

export const TREE_QUERY = /* GraphQL */ `
  query AIFetchUserTree($input: AI_FetchUserTreeInput!) {
    aiFetchUserTree(input: $input) {
      user {
        ...TreeNodeFields
      }
      organization {
        ...TreeNodeFields
      }
      global {
        ...TreeNodeFields
      }
    }
  }

  fragment TreeNodeFields on AI_TreeNode {
    id
    nodeType
    name
    slug
    children {
      id
      nodeType
      name
      slug
      children {
        id
        nodeType
        name
        slug
        children {
          id
          nodeType
          name
          slug
        }
      }
    }
  }
`;
