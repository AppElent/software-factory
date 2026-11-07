import { useClerk, useUser } from "@clerk/react";
import { useEffect, useState } from "react";
import { AppearanceSettings } from "./AppearanceSettings";
import { AuthButton } from "./AuthButton";
import { AuthError } from "./AuthError";
import { AuthField } from "./AuthField";
import { clerkErrorMessage } from "./core";

export function ProfilePanel() {
	const { isLoaded, user } = useUser();
	const { signOut } = useClerk();
	const [firstName, setFirstName] = useState("");
	const [lastName, setLastName] = useState("");
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [savingProfile, setSavingProfile] = useState(false);
	const [savingPassword, setSavingPassword] = useState(false);

	useEffect(() => {
		if (user) {
			setFirstName(user.firstName ?? "");
			setLastName(user.lastName ?? "");
		}
	}, [user]);

	if (!isLoaded || !user) {
		return <p className="text-sm text-[var(--auth-muted)]">Loading…</p>;
	}

	async function saveProfile(e: React.FormEvent) {
		e.preventDefault();
		if (!user) {
			return;
		}
		setError(null);
		setSavingProfile(true);
		try {
			await user.update({ firstName, lastName });
		} catch (err) {
			setError(clerkErrorMessage(err));
		} finally {
			setSavingProfile(false);
		}
	}

	async function changePassword(e: React.FormEvent) {
		e.preventDefault();
		if (!user) {
			return;
		}
		setError(null);
		setSavingPassword(true);
		try {
			await user.updatePassword({ currentPassword, newPassword });
			setCurrentPassword("");
			setNewPassword("");
		} catch (err) {
			setError(clerkErrorMessage(err));
		} finally {
			setSavingPassword(false);
		}
	}

	return (
		<div className="space-y-6">
			<AuthError message={error} />

			<section className="rm-panel p-4">
				<p className="rm-label">Profile</p>
				<form
					onSubmit={saveProfile}
					className="mt-3 flex flex-col gap-3"
					noValidate
				>
					<AuthField
						label="First name"
						type="text"
						value={firstName}
						onChange={setFirstName}
					/>
					<AuthField
						label="Last name"
						type="text"
						value={lastName}
						onChange={setLastName}
					/>
					<p className="text-xs text-[var(--auth-muted)]">
						Email: {user.primaryEmailAddress?.emailAddress}
					</p>
					<AuthButton loading={savingProfile}>Save profile</AuthButton>
				</form>
			</section>

			<section className="rm-panel p-4">
				<p className="rm-label">Security</p>
				<form
					onSubmit={changePassword}
					className="mt-3 flex flex-col gap-3"
					noValidate
				>
					<AuthField
						label="Current password"
						type="password"
						autoComplete="current-password"
						value={currentPassword}
						onChange={setCurrentPassword}
					/>
					<AuthField
						label="New password"
						type="password"
						autoComplete="new-password"
						value={newPassword}
						onChange={setNewPassword}
					/>
					<AuthButton loading={savingPassword}>Change password</AuthButton>
				</form>
			</section>

			<AppearanceSettings />

			<section className="rm-panel p-4">
				<p className="rm-label">Session</p>
				<div className="mt-3">
					<AuthButton type="button" variant="ghost" onClick={() => signOut()}>
						Sign out
					</AuthButton>
				</div>
			</section>
		</div>
	);
}
