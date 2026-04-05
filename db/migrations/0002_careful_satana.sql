CREATE TABLE `configs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`content_json` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`config_id` text NOT NULL,
	`seed` integer NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`tick_count` integer NOT NULL,
	`summary_json` text,
	`classification` text,
	`error_message` text,
	`created_by` text,
	FOREIGN KEY (`config_id`) REFERENCES `configs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `tick_metrics` (
	`run_id` text NOT NULL,
	`tick` integer NOT NULL,
	`world` text NOT NULL,
	`metric_name` text NOT NULL,
	`metric_value` real NOT NULL,
	PRIMARY KEY(`run_id`, `tick`, `world`, `metric_name`),
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tick_metrics_run_metric_idx` ON `tick_metrics` (`run_id`,`metric_name`);--> statement-breakpoint
CREATE INDEX `tick_metrics_run_tick_idx` ON `tick_metrics` (`run_id`,`tick`);--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`tick` integer NOT NULL,
	`kind` text NOT NULL,
	`content_json` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `snapshots_run_tick_idx` ON `snapshots` (`run_id`,`tick`);