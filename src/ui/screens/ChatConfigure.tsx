import { useEffect, useState } from 'react';
import { Bot, Link2, Settings, Zap, Save, X } from 'lucide-react';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Badge } from '../components/Badge';
import { FormField } from '../components/FormField';
import { Modal } from '../components/Modal';
import { listAgents, listWorkflows } from '@/dataloaders';
import { useUiDataContext } from "../contexts/AuthSessionContext";
import type { AIAgentRecord, EntityRecord } from '@/orm';
import { useToast } from '../components/Toast';

interface Workflow {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'paused';
}

interface AIAgent {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'inactive';
  model: string;
}

type AttachmentType = 'workflow' | 'agent';
type WorkflowRecord = EntityRecord & { status: Workflow['status'] };
type AgentRecord = AIAgentRecord & { status: AIAgent['status'] };

export default function ChatConfigure() {
  const context = useUiDataContext();
  const { showToast } = useToast();
  const [chatName, setChatName] = useState('Customer Support Bot');
  const [chatDescription, setChatDescription] = useState('AI assistant for customer inquiries');
  const [attachmentType, setAttachmentType] = useState<AttachmentType>('agent');
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [availableWorkflows, setAvailableWorkflows] = useState<Workflow[]>([]);
  const [availableAgents, setAvailableAgents] = useState<AIAgent[]>([]);

  useEffect(() => {
    let active = true;

    const loadAttachments = async () => {
      const [workflowResult, agentResult] = await Promise.all([
        listWorkflows(context),
        listAgents(context),
      ]);
      const workflows = (workflowResult.rows as WorkflowRecord[]).map((row) => ({
        id: row.id,
        name: row.title,
        description: row.subtitle,
        status: row.status,
      }));
      const agents = (agentResult as AgentRecord[]).map((agent) => ({
        id: agent.id,
        name: agent.title,
        description: agent.subtitle,
        status: agent.status,
        model: agent.modelId,
      }));

      if (active) {
        setAvailableWorkflows(workflows);
        setAvailableAgents(agents);
        setSelectedAgent((current) => current || agents[0]?.id || null);
      }
    };

    void loadAttachments();
    return () => {
      active = false;
    };
  }, []);

  const selectedWorkflowData = availableWorkflows.find(w => w.id === selectedWorkflow);
  const selectedAgentData = availableAgents.find(a => a.id === selectedAgent);

  const handleSave = () => {
    showToast('info', 'Chat configuration save requires a chat configuration dataloader.');
  };

  const handleSelect = (id: string) => {
    if (attachmentType === 'workflow') {
      setSelectedWorkflow(id);
    } else {
      setSelectedAgent(id);
    }
    setShowPicker(false);
  };

  const handleRemove = () => {
    if (attachmentType === 'workflow') {
      setSelectedWorkflow(null);
    } else {
      setSelectedAgent(null);
    }
  };

  return (
    <div className="min-h-screen bg-background dark:bg-[#0a0a0a]">
      <div className="max-w-4xl mx-auto px-8 py-12">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2 dark:text-gray-100">Configure Chat Agent</h1>
          <p className="text-muted-foreground dark:text-gray-400">
            Customize your chat settings and attach AI capabilities
          </p>
        </div>

        <div className="space-y-6">
          {/* Basic Information */}
          <Card>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Bot className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-xl font-semibold dark:text-gray-100">Basic Information</h2>
            </div>

            <div className="space-y-4">
              <FormField
                label="Chat Agent Name"
                value={chatName}
                onChange={setChatName}
                placeholder="Enter chat agent name"
              />

              <FormField
                label="Description"
                value={chatDescription}
                onChange={setChatDescription}
                placeholder="Enter description"
                multiline
                rows={3}
              />
            </div>
          </Card>

          {/* AI Capability Attachment */}
          <Card>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                <Zap className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <h2 className="text-xl font-semibold dark:text-gray-100">AI Capability</h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-3 dark:text-gray-200">
                  Attachment Type
                </label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setAttachmentType('agent')}
                    className={`flex-1 px-4 py-3 rounded-lg border-2 transition-all ${
                      attachmentType === 'agent'
                        ? 'border-primary bg-primary/5 dark:bg-primary/10'
                        : 'border-border dark:border-[#2a2a2a] hover:border-primary/50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Bot className={`w-5 h-5 ${
                        attachmentType === 'agent' ? 'text-primary' : 'text-muted-foreground dark:text-gray-400'
                      }`} />
                      <div className="text-left">
                        <div className={`font-semibold ${
                          attachmentType === 'agent' ? 'text-primary' : 'dark:text-gray-200'
                        }`}>
                          AI Agent
                        </div>
                        <div className="text-xs text-muted-foreground dark:text-gray-400">
                          Intelligent agent with tools and guardrails
                        </div>
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => setAttachmentType('workflow')}
                    className={`flex-1 px-4 py-3 rounded-lg border-2 transition-all ${
                      attachmentType === 'workflow'
                        ? 'border-primary bg-primary/5 dark:bg-primary/10'
                        : 'border-border dark:border-[#2a2a2a] hover:border-primary/50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Zap className={`w-5 h-5 ${
                        attachmentType === 'workflow' ? 'text-primary' : 'text-muted-foreground dark:text-gray-400'
                      }`} />
                      <div className="text-left">
                        <div className={`font-semibold ${
                          attachmentType === 'workflow' ? 'text-primary' : 'dark:text-gray-200'
                        }`}>
                          Workflow
                        </div>
                        <div className="text-xs text-muted-foreground dark:text-gray-400">
                          Custom logic and automation workflow
                        </div>
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Selected Attachment Display */}
              {attachmentType === 'agent' && selectedAgentData ? (
                <div className="border border-border dark:border-[#2a2a2a] rounded-lg p-4 bg-secondary/30 dark:bg-[#1a1a1a]">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center">
                        <Bot className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <h3 className="font-semibold dark:text-gray-100">
                          {selectedAgentData.name}
                        </h3>
                        <p className="text-sm text-muted-foreground dark:text-gray-400">
                          {selectedAgentData.description}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleRemove}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={selectedAgentData.status === 'active' ? 'success' : 'warning'}>
                      {selectedAgentData.status}
                    </Badge>
                    <span className="text-xs px-2 py-1 bg-secondary dark:bg-[#2a2a2a] rounded">
                      {selectedAgentData.model}
                    </span>
                  </div>
                </div>
              ) : attachmentType === 'workflow' && selectedWorkflowData ? (
                <div className="border border-border dark:border-[#2a2a2a] rounded-lg p-4 bg-secondary/30 dark:bg-[#1a1a1a]">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                        <Zap className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                      </div>
                      <div>
                        <h3 className="font-semibold dark:text-gray-100">
                          {selectedWorkflowData.name}
                        </h3>
                        <p className="text-sm text-muted-foreground dark:text-gray-400">
                          {selectedWorkflowData.description}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleRemove}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={selectedWorkflowData.status === 'active' ? 'success' : 'warning'}>
                      {selectedWorkflowData.status}
                    </Badge>
                  </div>
                </div>
              ) : (
                <div className="border-2 border-dashed border-border dark:border-[#2a2a2a] rounded-lg p-8 text-center">
                  {attachmentType === 'agent' ? (
                    <>
                      <Bot className="w-12 h-12 text-muted-foreground dark:text-gray-600 mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground dark:text-gray-400 mb-4">
                        No AI agent attached
                      </p>
                    </>
                  ) : (
                    <>
                      <Zap className="w-12 h-12 text-muted-foreground dark:text-gray-600 mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground dark:text-gray-400 mb-4">
                        No workflow attached
                      </p>
                    </>
                  )}
                  <Button onClick={() => setShowPicker(true)} className="gap-2">
                    <Link2 className="w-4 h-4" />
                    Attach {attachmentType === 'agent' ? 'Agent' : 'Workflow'}
                  </Button>
                </div>
              )}

              {(selectedAgentData || selectedWorkflowData) && (
                <Button
                  onClick={() => setShowPicker(true)}
                  variant="outline"
                  className="w-full gap-2"
                >
                  <Link2 className="w-4 h-4" />
                  Change {attachmentType === 'agent' ? 'Agent' : 'Workflow'}
                </Button>
              )}
            </div>
          </Card>

          {/* Advanced Settings */}
          <Card>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <Settings className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <h2 className="text-xl font-semibold dark:text-gray-100">Advanced Settings</h2>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium dark:text-gray-200">Enable context memory</h3>
                  <p className="text-sm text-muted-foreground dark:text-gray-400">
                    Remember conversation history across sessions
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" defaultChecked />
                  <div className="w-11 h-6 bg-gray-200 dark:bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/30 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium dark:text-gray-200">Auto-response mode</h3>
                  <p className="text-sm text-muted-foreground dark:text-gray-400">
                    Automatically respond to common queries
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" />
                  <div className="w-11 h-6 bg-gray-200 dark:bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/30 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>
            </div>
          </Card>

          {/* Actions */}
          <div className="flex gap-3 justify-end">
            <Button variant="outline">Cancel</Button>
            <Button onClick={handleSave} className="gap-2">
              <Save className="w-4 h-4" />
              Save Configuration
            </Button>
          </div>
        </div>
      </div>

      {/* Picker Modal */}
      <Modal
        isOpen={showPicker}
        onClose={() => setShowPicker(false)}
        title={`Select ${attachmentType === 'agent' ? 'AI Agent' : 'Workflow'}`}
      >
        <div className="space-y-3">
          {attachmentType === 'agent' ? (
            availableAgents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => handleSelect(agent.id)}
                className={`w-full text-left p-4 border rounded-lg transition-all hover:border-primary dark:hover:border-primary ${
                  selectedAgent === agent.id
                    ? 'border-primary dark:border-primary bg-primary/5 dark:bg-primary/10'
                    : 'border-border dark:border-[#2a2a2a]'
                }`}
              >
                <div className="flex items-start gap-3 mb-2">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold dark:text-gray-100">{agent.name}</h3>
                      <Badge variant={agent.status === 'active' ? 'success' : 'warning'}>
                        {agent.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground dark:text-gray-400 mb-2">
                      {agent.description}
                    </p>
                    <span className="text-xs px-2 py-1 bg-secondary dark:bg-[#2a2a2a] rounded">
                      {agent.model}
                    </span>
                  </div>
                </div>
              </button>
            ))
          ) : (
            availableWorkflows.map((workflow) => (
              <button
                key={workflow.id}
                onClick={() => handleSelect(workflow.id)}
                className={`w-full text-left p-4 border rounded-lg transition-all hover:border-primary dark:hover:border-primary ${
                  selectedWorkflow === workflow.id
                    ? 'border-primary dark:border-primary bg-primary/5 dark:bg-primary/10'
                    : 'border-border dark:border-[#2a2a2a]'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold dark:text-gray-100">{workflow.name}</h3>
                  <Badge variant={workflow.status === 'active' ? 'success' : 'warning'}>
                    {workflow.status}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground dark:text-gray-400">
                  {workflow.description}
                </p>
              </button>
            ))
          )}
        </div>
      </Modal>
    </div>
  );
}
