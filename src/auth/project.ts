import { GatewayClient } from '../api/client';
import { bootstrapMetadata, DISCOVERY_ENDPOINTS, FALLBACK_PROJECT_ID } from '../api/constants';
import { AccountStore } from './store';
import { log } from '../log';

interface LoadCodeAssistResponse {
	cloudaicompanionProject?: string;
	currentTier?: { id?: string };
	allowedTiers?: Array<{ id?: string; isDefault?: boolean; userDefinedCloudaicompanionProject?: boolean }>;
}

interface OnboardUserResponse {
	done?: boolean;
	response?: { cloudaicompanionProject?: { id?: string } };
}

/**
 * Resolves the Cloud Code project the gateway bills requests against.
 *
 * Order: cached value → `loadCodeAssist` → `onboardUser` → the hardcoded fallback.
 * Workspace and Business accounts frequently return nothing from `loadCodeAssist`,
 * which is why the fallback exists at all.
 */
export class ProjectResolver {
	constructor(
		private readonly client: GatewayClient,
		private readonly store: AccountStore,
	) {}

	async resolve(op: string, configuredProjectId?: string): Promise<string> {
		if (configuredProjectId) {
			return configuredProjectId;
		}

		const account = await this.store.active();
		if (account?.projectId) {
			return account.projectId;
		}

		let projectId: string | undefined;
		try {
			projectId = await this.load(op);
		} catch (error) {
			log.warn(op, 'loadCodeAssist failed', { error });
		}

		if (!projectId) {
			try {
				projectId = await this.onboard(op);
			} catch (error) {
				log.warn(op, 'onboardUser failed', { error });
			}
		}

		if (!projectId) {
			log.warn(op, 'falling back to default project id');
			projectId = FALLBACK_PROJECT_ID;
		}

		if (account) {
			await this.store.setProjectId(account.email, projectId);
		}
		log.info(op, 'project resolved', { projectId });
		return projectId;
	}

	private async load(op: string): Promise<string | undefined> {
		const response = await this.client.postJson<LoadCodeAssistResponse>({
			op,
			action: 'loadCodeAssist',
			endpoints: DISCOVERY_ENDPOINTS,
			body: { metadata: bootstrapMetadata() },
		});
		return response.cloudaicompanionProject || undefined;
	}

	private async onboard(op: string): Promise<string | undefined> {
		const response = await this.client.postJson<OnboardUserResponse>({
			op,
			action: 'onboardUser',
			endpoints: DISCOVERY_ENDPOINTS,
			body: { tierId: 'free-tier', metadata: bootstrapMetadata() },
		});
		return response.response?.cloudaicompanionProject?.id || undefined;
	}
}
