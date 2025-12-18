import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, ItemView, Modal, Notice, setIcon, Menu } from 'obsidian';

// --- Interfaces ---

interface Task {
	id: string;
	text: string;
	completed: boolean;
	dueDate?: string; // YYYY-MM-DD
}

interface Category {
	id: string;
	name: string;
	tasks: Task[];
	isCollapsed?: boolean;
	color?: string;
	lastSortOrder?: 'asc' | 'desc';
}

interface SimpleTasksBlocksSettings {
	categories: Category[];
	confirmTaskDeletion: boolean;
	dateFormat: 'YYYY-MM-DD' | 'DD-MM-YYYY' | 'Automatic';
}

const DEFAULT_SETTINGS: SimpleTasksBlocksSettings = {
	categories: [],
	confirmTaskDeletion: false,
	dateFormat: 'Automatic'
}

const VIEW_TYPE_TASKS = "simple-tasks-blocks-view";

const COLORS = {
	'Default': '',
	'Red': 'rgba(233, 30, 99, 0.1)',
	'Green': 'rgba(76, 175, 80, 0.1)',
	'Blue': 'rgba(33, 150, 243, 0.1)',
	'Yellow': 'rgba(255, 235, 59, 0.1)',
	'Purple': 'rgba(156, 39, 176, 0.1)',
	'Grey': 'rgba(158, 158, 158, 0.1)'
};

// --- Main Plugin Class ---

export default class SimpleTasksBlocksPlugin extends Plugin {
	settings: SimpleTasksBlocksSettings;
	view: TasksView | null = null;

	async onload() {
		await this.loadSettings();

		// Register the view
		this.registerView(
			VIEW_TYPE_TASKS,
			(leaf) => {
				this.view = new TasksView(leaf, this);
				return this.view;
			}
		);

		// Add Ribbon Icon
		this.addRibbonIcon('list-checks', 'Simple Tasks Blocks', (evt: MouseEvent) => {
			this.activateView();
		});

		// Add Command
		this.addCommand({
			id: 'create-new-task-category',
			name: 'Create new task category',
			callback: () => {
				new AddCategoryModal(this.app, (name, firstTask, date) => {
					this.addCategory(name, firstTask, date);
				}).open();
			}
		});

		// Add Settings Tab
		this.addSettingTab(new SimpleTasksBlocksSettingTab(this.app, this));
	}

	async onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_TASKS);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Refresh view if it exists
		if (this.view) {
			this.view.refresh();
		}
	}

	async addCategory(name: string, firstTaskText: string, dueDate?: string) {
		const newCategory: Category = {
			id: Date.now().toString(),
			name: name,
			tasks: [],
			isCollapsed: false,
			color: ''
		};
		
		if (firstTaskText) {
			newCategory.tasks.push({
				id: Date.now().toString() + '-task',
				text: firstTaskText,
				completed: false,
				dueDate: dueDate
			});
		}

		this.settings.categories.push(newCategory);
		await this.saveSettings();
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_TASKS);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			leaf = workspace.getRightLeaf(false);
			await leaf.setViewState({ type: VIEW_TYPE_TASKS, active: true });
		}

		workspace.revealLeaf(leaf);
	}
}

// --- Settings Tab ---

class SimpleTasksBlocksSettingTab extends PluginSettingTab {
	plugin: SimpleTasksBlocksPlugin;

	constructor(app: App, plugin: SimpleTasksBlocksPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Settings for Simple Tasks Blocks' });

		new Setting(containerEl)
			.setName('Confirm task deletion')
			.setDesc('Ask for confirmation before deleting a task.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.confirmTaskDeletion)
				.onChange(async (value) => {
					this.plugin.settings.confirmTaskDeletion = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Date Format')
			.setDesc('Choose how dates are displayed.')
			.addDropdown(dropdown => dropdown
				.addOption('Automatic', 'Automatic')
				.addOption('YYYY-MM-DD', 'YYYY-MM-DD')
				.addOption('DD-MM-YYYY', 'DD-MM-YYYY')
				.setValue(this.plugin.settings.dateFormat)
				.onChange(async (value) => {
					this.plugin.settings.dateFormat = value as any;
					await this.plugin.saveSettings();
				}));
	}
}

// --- View ---

class TasksView extends ItemView {
	plugin: SimpleTasksBlocksPlugin;
	draggedCategoryIndex: number | null = null;
	icon = "list-checks";

	constructor(leaf: WorkspaceLeaf, plugin: SimpleTasksBlocksPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return VIEW_TYPE_TASKS;
	}

	getDisplayText() {
		return "Simple Tasks Blocks";
	}

	async onOpen() {
		this.refresh();
	}

	async onClose() {
		// Cleanup
	}

	refresh() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('stb-container');

		// Header (Sticky)
		const header = container.createEl('div', { cls: 'stb-header' });
		const grid = header.createEl('div', { cls: 'stb-header-grid' });
		
		const leftPart = grid.createEl('div', { cls: 'stb-header-part-left' }); 
		
		const centerPart = grid.createEl('div', { cls: 'stb-header-part-center' });
		const addCategoryBtn = centerPart.createEl('button', { text: '+ Category', cls: 'mod-cta' });
		addCategoryBtn.addEventListener('click', () => {
			new AddCategoryModal(this.app, (name, firstTask, date) => {
				this.plugin.addCategory(name, firstTask, date);
			}).open();
		});

		const rightPart = grid.createEl('div', { cls: 'stb-header-part-right' });
		
		const toggleAllBtn = rightPart.createEl('div', { cls: 'stb-header-icon clickable-icon' });
		setIcon(toggleAllBtn, 'chevrons-up-down');
		toggleAllBtn.setAttribute('aria-label', 'Fold/Unfold All');
		toggleAllBtn.addEventListener('click', () => {
			this.toggleAllCategories();
		});

		const cleanBtn = rightPart.createEl('div', { cls: 'stb-header-icon clickable-icon' });
		setIcon(cleanBtn, 'eraser');
		cleanBtn.setAttribute('aria-label', 'Clean Completed Tasks');
		cleanBtn.addEventListener('click', () => {
			new ConfirmModal(this.app, "Delete ALL completed tasks from ALL categories?", async () => {
				await this.cleanCompletedTasks();
			}).open();
		});


		// Categories List (Scrollable)
		const categoriesContainer = container.createEl('div', { cls: 'stb-categories-list' });

		this.plugin.settings.categories.forEach((category, index) => {
			this.renderCategory(categoriesContainer, category, index);
		});
	}

	renderCategory(container: HTMLElement, category: Category, index: number) {
		const catBlock = container.createEl('div', { cls: 'stb-category-block' });
		if (category.color) {
			catBlock.style.backgroundColor = category.color;
		}

		// Drag & Drop Attributes
		catBlock.setAttribute('draggable', 'true');
		catBlock.addEventListener('dragstart', (e) => {
			this.draggedCategoryIndex = index;
			catBlock.addClass('stb-dragging');
			e.dataTransfer?.setData('text/plain', index.toString());
			// Drag effect
			if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
		});

		catBlock.addEventListener('dragend', () => {
			catBlock.removeClass('stb-dragging');
			this.draggedCategoryIndex = null;
			
			// Remove all drag-over classes
			const allBlocks = container.querySelectorAll('.stb-category-block');
			allBlocks.forEach(b => b.removeClass('stb-drag-over'));
		});

		catBlock.addEventListener('dragover', (e) => {
			e.preventDefault(); // Necessary to allow dropping
			if (this.draggedCategoryIndex === null || this.draggedCategoryIndex === index) return;
			
			catBlock.addClass('stb-drag-over');
			// Optional: determine if dropping above or below based on mouse Y
		});

		catBlock.addEventListener('dragleave', () => {
			catBlock.removeClass('stb-drag-over');
		});

		catBlock.addEventListener('drop', async (e) => {
			e.preventDefault();
			catBlock.removeClass('stb-drag-over');
			
			if (this.draggedCategoryIndex !== null && this.draggedCategoryIndex !== index) {
				await this.reorderCategories(this.draggedCategoryIndex, index);
			}
		});

		// Context Menu for Color
		catBlock.addEventListener('contextmenu', (event: MouseEvent) => {
			event.preventDefault();
			const menu = new Menu();
			
			menu.addItem((item) => {
				item.setTitle("Change Color")
					.setIcon("palette");
			});
			
			menu.addSeparator();

			Object.keys(COLORS).forEach((colorName) => {
				menu.addItem((item) => {
					item.setTitle(colorName)
						.setChecked(category.color === (COLORS as any)[colorName])
						.onClick(async () => {
							category.color = (COLORS as any)[colorName];
							await this.plugin.saveSettings();
						});
				});
			});

			menu.showAtPosition({ x: event.clientX, y: event.clientY });
		});


		// Category Header
		const catHeader = catBlock.createEl('div', { cls: 'stb-category-header' });
		
		// Drag Handle
		const dragHandle = catHeader.createEl('div', { cls: 'stb-drag-handle clickable-icon' });
		setIcon(dragHandle, 'grip-vertical'); // 'grip-vertical' looks like 6 dots usually

		// 1. Chevron
		const chevron = catHeader.createEl('div', { cls: 'stb-cat-chevron clickable-icon' });
		setIcon(chevron, category.isCollapsed ? 'chevron-right' : 'chevron-down');
		chevron.addEventListener('click', async (e) => {
			e.stopPropagation(); // prevent other clicks
			category.isCollapsed = !category.isCollapsed;
			await this.plugin.saveSettings();
		});

		// 2. Title (Editable)
		const title = catHeader.createEl('h3', { text: category.name });
		title.addEventListener('click', (e) => {
			e.stopPropagation();
			this.makeEditable(title, async (newText) => {
				if (newText && newText !== category.name) {
					category.name = newText;
					await this.plugin.saveSettings();
				}
			});
		});

		// 3. Sort Button
		const sortBtn = catHeader.createEl('div', { cls: 'stb-cat-sort-btn clickable-icon' });
		setIcon(sortBtn, 'arrow-up-down');
		sortBtn.setAttribute('aria-label', 'Sort Tasks by Date');
		sortBtn.addEventListener('click', async (e) => {
			e.stopPropagation();
			await this.sortCategoryTasks(category.id);
		});
		
		// 4. Add Task Button
		const addTaskHeaderBtn = catHeader.createEl('div', { cls: 'stb-cat-add-btn clickable-icon' });
		setIcon(addTaskHeaderBtn, 'plus');
		addTaskHeaderBtn.setAttribute('aria-label', 'Add Task');

		// Spacer
		catHeader.createEl('div', { cls: 'stb-spacer' });

		// 4. Delete Category Button
		const deleteCatBtn = catHeader.createEl('div', { cls: 'stb-delete-cat-btn clickable-icon' });
		setIcon(deleteCatBtn, 'trash');
		deleteCatBtn.setAttribute('aria-label', 'Delete Category');
		deleteCatBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			new ConfirmModal(this.app, `Are you sure you want to delete category "${category.name}"?`, async () => {
				await this.deleteCategory(category.id);
			}).open();
		});

		// Tasks List (Body)
		if (!category.isCollapsed) {
			const tasksList = catBlock.createEl('div', { cls: 'stb-tasks-list' });
			category.tasks.forEach(task => {
				this.renderTask(tasksList, category, task);
			});

			// Inline Add Task Logic
			const inlineContainer = catBlock.createEl('div', { cls: 'stb-add-task-inline' });
			inlineContainer.hide(); // Hidden by default

			const showInput = () => {
				inlineContainer.show();
				inlineContainer.empty();
				
				const wrapper = inlineContainer.createEl('div', { cls: 'stb-inline-input-wrapper' });
				
				const input = wrapper.createEl('input', { type: 'text', placeholder: 'New task...' });
				input.focus();

				// Date Picker Icon
				const dateBtn = wrapper.createEl('div', { cls: 'stb-inline-date-btn clickable-icon' });
				setIcon(dateBtn, 'calendar');
				
				// Hidden Date Input
				const dateInput = wrapper.createEl('input', { type: 'date', cls: 'stb-hidden-date-input' });
				dateInput.style.display = 'none'; // Ensure hidden initially

				dateBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					// Toggle date input visibility or trigger it
					// Native date input trigger is tricky programmatically on some browsers/OS
					// But usually showPicker() works on modern browsers
					if ('showPicker' in HTMLInputElement.prototype) {
						try {
							(dateInput as any).showPicker();
						} catch (error) {
							// Fallback: Toggle visibility
							dateInput.style.display = dateInput.style.display === 'none' ? 'block' : 'none';
							if (dateInput.style.display === 'block') dateInput.focus();
						}
					} else {
						dateInput.style.display = dateInput.style.display === 'none' ? 'block' : 'none';
						if (dateInput.style.display === 'block') dateInput.focus();
					}
				});
				
				// Update icon style when date is selected
				dateInput.addEventListener('change', () => {
					if (dateInput.value) {
						dateBtn.addClass('has-date');
						dateBtn.setAttribute('title', dateInput.value);
					} else {
						dateBtn.removeClass('has-date');
						dateBtn.removeAttribute('title');
					}
				});

				const submit = async () => {
					const text = input.value.trim();
					if (text) {
						await this.addTask(category.id, text, dateInput.value || undefined);
					}
					inlineContainer.empty();
					inlineContainer.hide();
				};

				input.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') submit();
					if (e.key === 'Escape') {
						inlineContainer.empty();
						inlineContainer.hide();
					}
				});
				
				// Only blur if we are not clicking the date stuff
				// This is tricky because blur happens before click.
				// We can use a small timeout or check relatedTarget
				input.addEventListener('blur', (e) => {
					// Check if focus moved to date input or button
					if (e.relatedTarget === dateInput || e.relatedTarget === dateBtn || wrapper.contains(e.relatedTarget as Node)) {
						return; 
					}
					
					// Also check if we are just picking a date (the browser picker might take focus away entirely)
					// So simple blur might close it prematurely.
					// Let's rely on explicit Escape or Enter for now, or just handle blur carefully.
					// If we really want blur to close:
					/*
					setTimeout(() => {
						if (!wrapper.contains(document.activeElement)) {
							inlineContainer.empty();
							inlineContainer.hide();
						}
					}, 200);
					*/
				});
			};

			addTaskHeaderBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				showInput();
			});
		}
	}

	formatDate(dateStr: string): string {
		if (!dateStr) return '';
		const format = this.plugin.settings.dateFormat;
		let useFr = false;

		if (format === 'Automatic') {
			// @ts-ignore
			const locale = window.moment ? window.moment.locale() : 'en';
			if (locale.startsWith('fr')) useFr = true;
		} else if (format === 'DD-MM-YYYY') {
			useFr = true;
		}

		if (useFr) {
			const [y, m, d] = dateStr.split('-');
			return `${d}-${m}-${y}`;
		}
		return dateStr;
	}

	renderTask(container: HTMLElement, category: Category, task: Task) {
		const taskRow = container.createEl('div', { cls: 'stb-task-row' });
		
		// Checkbox
		const checkbox = taskRow.createEl('input', { type: 'checkbox' });
		checkbox.checked = task.completed;
		checkbox.addEventListener('change', async () => {
			await this.toggleTask(category.id, task.id, checkbox.checked);
		});

		// Text (Editable)
		const taskText = taskRow.createEl('span', { cls: 'stb-task-text', text: task.text });
		if (task.completed) taskText.addClass('is-completed');

		taskText.addEventListener('click', (e) => {
			e.stopPropagation();
			// Don't edit if completed? Maybe yes? Usually yes.
			this.makeEditable(taskText, async (newText) => {
				if (newText && newText !== task.text) {
					task.text = newText;
					await this.plugin.saveSettings();
				}
			});
		});

		// Container for right-aligned items (Date, Edit, Delete)
		const rightActions = taskRow.createEl('div', { cls: 'stb-task-right-actions' });

		// Date Badge
		if (task.dueDate) {
			const formattedDate = this.formatDate(task.dueDate);
			const dateBadge = rightActions.createEl('span', { cls: 'stb-date-badge', text: formattedDate });
			
			// Logic for Today / Overdue
			// ... comparison logic ...
			const todayStr = new Date().toISOString().split('T')[0];
			
			if (task.dueDate < todayStr) {
				dateBadge.addClass('is-overdue');
			} else if (task.dueDate === todayStr) {
				dateBadge.addClass('is-today');
			}
		}

		// Edit Date Button (Context Menu or Icon)
		// Let's add a small calendar icon button next to text or date badge
		const dateEditBtn = rightActions.createEl('div', { cls: 'stb-task-date-btn clickable-icon' });
		setIcon(dateEditBtn, 'calendar');
		// Hidden input for editing
		const dateEditInput = rightActions.createEl('input', { type: 'date', cls: 'stb-hidden-date-input' });
		dateEditInput.style.display = 'none';
		if (task.dueDate) dateEditInput.value = task.dueDate;

		dateEditBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			if ('showPicker' in HTMLInputElement.prototype) {
				try {
					(dateEditInput as any).showPicker();
				} catch {
					dateEditInput.style.display = 'block';
					dateEditInput.focus();
				}
			} else {
				dateEditInput.style.display = 'block';
				dateEditInput.focus();
			}
		});

		dateEditInput.addEventListener('change', async () => {
			if (dateEditInput.value !== task.dueDate) {
				task.dueDate = dateEditInput.value;
				await this.plugin.saveSettings(); // This refreshes view
			}
			dateEditInput.style.display = 'none';
		});
		
		dateEditInput.addEventListener('blur', () => {
			// Hide on blur if not changed (change event fires before blur if changed? usually)
			setTimeout(() => {
				dateEditInput.style.display = 'none';
			}, 200);
		});

		// Delete Task Button
		const deleteBtn = rightActions.createEl('div', { cls: 'stb-delete-task-btn clickable-icon' });
		setIcon(deleteBtn, 'x');
		deleteBtn.addEventListener('click', () => {
			if (this.plugin.settings.confirmTaskDeletion) {
				new ConfirmModal(this.app, `Delete task "${task.text}"?`, async () => {
					await this.deleteTask(category.id, task.id);
				}).open();
			} else {
				this.deleteTask(category.id, task.id);
			}
		});
	}

	// Helper for Inline Editing
	makeEditable(element: HTMLElement, onSave: (text: string) => Promise<void>) {
		const currentText = element.innerText;
		const input = element.createEl('input', { type: 'text', value: currentText, cls: 'stb-inline-input' });
		
		// Replace element content with input
		element.empty();
		element.appendChild(input);
		input.focus();
		
		// Prevent drag/click propagation while editing
		input.addEventListener('click', (e) => e.stopPropagation());

		const save = async () => {
			const newText = input.value.trim();
			// Restore original if empty or just same
			if (!newText) {
				element.empty();
				element.innerText = currentText;
				return;
			}
			await onSave(newText); // This triggers saveSettings -> refresh, so element is rebuilt anyway
		};

		const cancel = () => {
			// Trigger refresh to restore view or just manually restore
			// Since saveSettings triggers refresh, we just need to ensure we don't save.
			// But we modified the DOM. The simplest way is to call refresh() ourselves or restore DOM.
			// Calling refresh() is safer to reset state.
			this.refresh();
		};

		input.addEventListener('keydown', async (e) => {
			if (e.key === 'Enter') {
				await save();
			}
			if (e.key === 'Escape') {
				cancel();
			}
		});

		input.addEventListener('blur', async () => {
			await save();
		});
	}

	async sortCategoryTasks(categoryId: string) {
		const category = this.plugin.settings.categories.find(c => c.id === categoryId);
		if (!category) return;

		const currentOrder = category.lastSortOrder || 'desc'; // Default to desc if not set (so first click becomes asc? or vice versa)
		// Usually people want to see Earliest first (Asc) or Latest first?
		// "Trier par date". Often Ascending (oldest/due soonest first).
		// If current is 'asc', switch to 'desc'.
		
		const newOrder = currentOrder === 'asc' ? 'desc' : 'asc';
		const todayStr = new Date().toISOString().split('T')[0];

		category.tasks.sort((a, b) => {
			const dateA = a.dueDate || todayStr;
			const dateB = b.dueDate || todayStr;

			if (dateA === dateB) return 0;
			
			if (newOrder === 'asc') {
				return dateA < dateB ? -1 : 1;
			} else {
				return dateA > dateB ? -1 : 1;
			}
		});

		category.lastSortOrder = newOrder;
		await this.plugin.saveSettings();
		new Notice(`Sorted tasks ${newOrder === 'asc' ? 'ascending' : 'descending'}`);
	}

	async reorderCategories(fromIndex: number, toIndex: number) {
		const categories = this.plugin.settings.categories;
		const [moved] = categories.splice(fromIndex, 1);
		categories.splice(toIndex, 0, moved);
		await this.plugin.saveSettings();
	}

	async addCategory(name: string, firstTaskText: string) {
		await this.plugin.addCategory(name, firstTaskText);
	}

	async deleteCategory(id: string) {
		this.plugin.settings.categories = this.plugin.settings.categories.filter(c => c.id !== id);
		await this.plugin.saveSettings();
	}

	async addTask(categoryId: string, text: string, dueDate?: string) {
		const category = this.plugin.settings.categories.find(c => c.id === categoryId);
		if (category) {
			category.tasks.push({
				id: Date.now().toString(),
				text: text,
				completed: false,
				dueDate: dueDate
			});
			await this.plugin.saveSettings();
		}
	}

	async toggleTask(categoryId: string, taskId: string, completed: boolean) {
		const category = this.plugin.settings.categories.find(c => c.id === categoryId);
		if (category) {
			const task = category.tasks.find(t => t.id === taskId);
			if (task) {
				task.completed = completed;
				await this.plugin.saveSettings();
			}
		}
	}

	async deleteTask(categoryId: string, taskId: string) {
		const category = this.plugin.settings.categories.find(c => c.id === categoryId);
		if (category) {
			category.tasks = category.tasks.filter(t => t.id !== taskId);
			await this.plugin.saveSettings();
		}
	}

	async toggleAllCategories() {
		const anyOpen = this.plugin.settings.categories.some(c => !c.isCollapsed);
		this.plugin.settings.categories.forEach(c => {
			c.isCollapsed = anyOpen; 
		});
		await this.plugin.saveSettings();
	}

	async cleanCompletedTasks() {
		this.plugin.settings.categories.forEach(c => {
			c.tasks = c.tasks.filter(t => !t.completed);
		});
		await this.plugin.saveSettings();
	}
}

// --- Modals ---

class AddCategoryModal extends Modal {
	onSubmit: (name: string, firstTask: string, date?: string) => void;

	constructor(app: App, onSubmit: (name: string, firstTask: string, date?: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Add New Category" });

		const nameDiv = contentEl.createDiv({ cls: 'stb-modal-field' });
		nameDiv.createEl("label", { text: "Category Name" });
		const nameInput = nameDiv.createEl("input", { type: "text" });

		const taskDiv = contentEl.createDiv({ cls: 'stb-modal-field' });
		taskDiv.createEl("label", { text: "First Task Name" });
		const taskInput = taskDiv.createEl("input", { type: "text" });

		const dateDiv = contentEl.createDiv({ cls: 'stb-modal-field' });
		dateDiv.createEl("label", { text: "Due Date (Optional)" });
		const dateInput = dateDiv.createEl("input", { type: "date" });

		const buttonDiv = contentEl.createDiv({ cls: 'stb-modal-actions' });
		const submitBtn = buttonDiv.createEl("button", { text: "Create", cls: "mod-cta" });

		submitBtn.addEventListener("click", () => {
			const name = nameInput.value.trim();
			const task = taskInput.value.trim();
			const date = dateInput.value;
			
			if (!name || !task) {
				new Notice("Both fields are required.");
				return;
			}

			this.onSubmit(name, task, date || undefined);
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class ConfirmModal extends Modal {
	message: string;
	onConfirm: () => void;

	constructor(app: App, message: string, onConfirm: () => void) {
		super(app);
		this.message = message;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: this.message });

		const buttonDiv = contentEl.createDiv({ cls: 'stb-modal-actions' });
		const confirmBtn = buttonDiv.createEl("button", { text: "Confirm", cls: "mod-warning" });
		const cancelBtn = buttonDiv.createEl("button", { text: "Cancel" });

		confirmBtn.addEventListener("click", () => {
			this.onConfirm();
			this.close();
		});

		cancelBtn.addEventListener("click", () => {
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
