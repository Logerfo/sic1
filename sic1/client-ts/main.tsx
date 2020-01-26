import { Assembler, Emulator, CompilationError, Constants, Variable } from "../../lib-ts/src/sic1asm"
import { Puzzle, puzzles } from "./puzzles"
declare const React: typeof import("react");
declare const ReactDOM: typeof import("react-dom");

// TODO: Puzzle load, including saving of previous puzzle
// TODO: Save puzzle progress
// TODO: Service integration
// TODO: Load last open puzzle
// TODO: Consider moving autoStep to state and having a "pause" button instead of "run"
// TODO: Consider getting rid of "load" and just having step/run load

interface MessageBoxContent {
    title: string;
    modal?: boolean;
    body: React.ReactFragment;
}

interface MessageBoxManager {
    showMessageBox: (properties: MessageBoxContent) => void;
    closeMessageBox: () => void;
}

interface Sic1Controller extends MessageBoxManager {
    showPuzzleList: () => void;
}

interface MessageBoxProperties extends MessageBoxContent {
    messageBoxManager: MessageBoxManager;
}

class MessageBox extends React.Component<MessageBoxProperties> {
    constructor(props) {
        super(props);
    }

    private close = () => {
        this.props.messageBoxManager.closeMessageBox();
    }

    public render() {
        return <>
            <div className="messageBox">
                <div className="messageHeader">
                    {this.props.title}
                    {this.props.modal ? null : <button className="messageClose" onClick={this.close}>X</button>}
                </div>
                <div className="messageBody">
                    {this.props.body}
                </div>
            </div>
            <div className="dimmer" onClick={this.props.modal ? null : this.close}></div>
        </>;
    }
}

// Charts
enum ChartState {
    loading,
    loaded,
    loadFailed,
}

interface ChartBucket {
    bucket: number;
    count: number;
}

interface ChartProperties {
    title: string;
    chartState: ChartState;
    highlightedValue: number;
    buckets?: ChartBucket[]
}

class Chart extends React.Component<ChartProperties> {
    constructor(props) {
        super(props);
    }

    public render() {
        let body: React.ReactFragment;
        if (this.props.chartState === ChartState.loaded) {
            // Find bucket to highlight, max count, and min/max values
            // TODO: Rewrite?
            const data = this.props;
            let maxCount = 1;
            let minValue = null;
            let maxValue = null;
            let highlightIndex = data.buckets.length - 1;
            for (let i = 0; i < data.buckets.length; i++) {
                const bucket = data.buckets[i];
                maxCount = Math.max(maxCount, bucket.count);
                maxValue = bucket.bucket;
                if (minValue === null) {
                    minValue = bucket.bucket;
                }

                if (bucket.bucket <= data.highlightedValue) {
                    highlightIndex = i;
                }
            }

            if (data.highlightedValue > 0 && data.buckets[highlightIndex].count <= 0) {
                data.buckets[highlightIndex].count = 1;
            }

            const chartHeight = 20;
            const scale = chartHeight / maxCount;
            let points = "";
            for (let i = 0; i < data.buckets.length; i++) {
                const count = data.buckets[i].count;
                points += " " + i + "," + (chartHeight - (count * scale));
                points += " " + (i + 1) + "," + (chartHeight - (count * scale));
            }

            body = <>
                <polyline className="chartLine" points={points}></polyline>
                <rect className="chartHighlight" x={highlightIndex} y={chartHeight - (data.buckets[highlightIndex].count * scale)} width="1" height={data.buckets[highlightIndex].count * scale}></rect>
                <text className="chartLeft" x="0" y="21.5">{minValue}</text>
                <text className="chartRight" x="20" y="21.5">{maxValue}</text>
            </>;

        } else {
            body = <>
                <text className="chartOverlay" x="10" y="10">{(this.props.chartState === ChartState.loading) ? "Loading..." : "Load Failed"}</text>
            </>;
        }

        return <svg className="chart" width="20em" height="24em" viewBox="0 -2 20 24">
            <rect x="0" y="-2" width="20" height="1.6"></rect>
            <line x1="0" y1="20" x2="20" y2="20"></line>
            <text className="chartTitle" x="10" y="-0.9">{this.props.title}</text>
            {body}
        </svg>;
    }
}

// Persistent state management
interface UserData {
    userId?: string;
    name?: string;
    introCompleted: boolean;
    solvedCount: number;
    currentPuzzle?: string;
}

interface PuzzleData {
    unlocked: boolean;
    viewed: boolean;
    solved: boolean;
    solutionCycles?: number;
    solutionBytes?: number;
    code?: string;
}

interface DataManager {
    defaultName: string;
    getData: () => UserData;
    saveData: () => void;
    getPuzzleData: (title: string) => PuzzleData;
    savePuzzleData: (title: string) => void;
}

const Sic1DataManager: DataManager = class Sic1DataManager {
    private static readonly userIdLength = 15;
    private static readonly prefix = "sic1_";

    private static cache = {};

    public static readonly defaultName = "Bill";

    private static generateUserId() {
        const characters = "abcdefghijklmnopqrstuvwxyz";
        let id = "";
        for (var i = 0; i < Sic1DataManager.userIdLength; i++) {
            id += characters[Math.floor(Math.random() * characters.length)];
        }
        return id;
    }

    private static createDefaultData(): UserData {
        return {
            userId: undefined,
            name: undefined,
            introCompleted: false,
            solvedCount: 0,
            currentPuzzle: undefined
        };
    }

    private static createDefaultPuzzleData(): PuzzleData {
        return {
            unlocked: false,
            viewed: false,
            solved: false,
            solutionCycles: undefined,
            solutionBytes: undefined,

            code: null
        };
    }

    private static loadObjectWithDefault<T>(key: string, defaultDataCreator: () => T): T {
        let data = Sic1DataManager.cache[key] as T;
        if (!data) {
            try {
                const str = localStorage.getItem(key);
                if (str) {
                    data = JSON.parse(str) as T;
                }
            } catch (e) {}

            data = data || defaultDataCreator();
            Sic1DataManager.cache[key] = data;
        }

        return data;
    }

    private static saveObject(key: string): void {
        try {
            localStorage.setItem(key, JSON.stringify(Sic1DataManager.cache[key]));
        } catch (e) {}
    }

    private static getPuzzleKey(title: string): string {
        return `${Sic1DataManager.prefix}Puzzle_${title}`;
    }

    public static getData(): UserData {
        const state = Sic1DataManager.loadObjectWithDefault<UserData>(Sic1DataManager.prefix, Sic1DataManager.createDefaultData);

        // Ensure user id and name are populated
        state.userId = (state.userId && state.userId.length === Sic1DataManager.userIdLength) ? state.userId : Sic1DataManager.generateUserId();
        state.name = (state.name && state.name.length > 0) ? state.name.slice(0, 50) : Sic1DataManager.defaultName;

        return state;
    }

    public static saveData(): void {
        Sic1DataManager.saveObject(Sic1DataManager.prefix);
    }

    public static getPuzzleData(title: string): PuzzleData {
        return Sic1DataManager.loadObjectWithDefault<PuzzleData>(Sic1DataManager.getPuzzleKey(title), Sic1DataManager.createDefaultPuzzleData);
    }

    public static savePuzzleData(title: string): void {
        Sic1DataManager.saveObject(Sic1DataManager.getPuzzleKey(title));
    }
}

// State management
enum StateFlags {
    none = 0x0,
    running = 0x1,
    error = 0x2,
    done = 0x4,
}

interface Sic1IdeProperties {
    puzzle: Puzzle;
    controller: Sic1Controller;
    inputBytes: number[];
    expectedOutputBytes: number[];
}

interface Sic1IdeTransientState {
    stateLabel: string;
    cyclesExecuted: number;
    memoryBytesAccessed: number;
    sourceLines: string[];

    actualOutputBytes: number[];

    currentSourceLine?: number;
    currentAddress?: number;
    unexpectedOutputIndexes: { [index: number]: boolean };
    variables: Variable[];

    // Memory
    [index: number]: number;
}

interface Sic1IdeState extends Sic1IdeTransientState {
}

class Sic1Ide extends React.Component<Sic1IdeProperties, Sic1IdeState> {
    private static autoStepIntervalMS = 40;

    private stateFlags = StateFlags.none;
    private autoStep = false;
    private runToken?: number;
    private memoryMap: number[][];
    private programBytes: number[];
    private emulator: Emulator;

    private inputCode = React.createRef<HTMLTextAreaElement>();

    constructor(props: Sic1IdeProperties) {
        super(props);

        const memoryMap: number[][] = [];
        for (let i = 0; i < 16; i++) {
            let row: number[] = [];
            for (let j = 0; j < 16; j++) {
                row.push(16 * i + j);
            }
            memoryMap.push(row);
        }
        this.memoryMap = memoryMap;

        let state: Sic1IdeState = Sic1Ide.createEmptyTransientState();
        this.state = state;
    }

    private static hexifyByte(v: number): string {
        var str = v.toString(16);
        if (str.length == 1) {
            str = "0" + str;
        }
        return str;
    }

    private static createEmptyTransientState(): Sic1IdeTransientState {
        let state: Sic1IdeTransientState = {
            stateLabel: "",
            cyclesExecuted: 0,
            memoryBytesAccessed: 0,
            sourceLines: [],
            actualOutputBytes: [],
            unexpectedOutputIndexes: {},
            variables: [],
        };

        // Initialize memory
        for (let i = 0; i < 256; i++) {
            state[i] = 0;
        }

        return state;
    }

    private static getDefaultCode(puzzle: Puzzle) {
        return puzzle.code;
    }

    private getLongestIOTable(): number[] {
        const a = this.props.inputBytes;
        const b = this.props.expectedOutputBytes;
        return (a.length >= b.length) ? a : b;
    }

    private showSuccessMessageBox(): void {
        // TODO: Load chart data

        this.props.controller.showMessageBox({
            title: "Success",
            modal: true,
            body: <>
                <h2>Well done!</h2>
                <p>Your program produced the correct output.</p>
                <p>Performance statistics of your program (as compared to others' programs):</p>
                <div className="charts">
                    <Chart chartState={ChartState.loading} highlightedValue={this.state.cyclesExecuted} title={`Cycles Executed: ${this.state.cyclesExecuted}`} />
                    <Chart chartState={ChartState.loading} highlightedValue={this.state.memoryBytesAccessed} title={`Bytes Read: ${this.state.memoryBytesAccessed}`} />
                </div>
                <p>Click this link to: <a href="#" onClick={(event) => {
                    event.preventDefault();
                    this.props.controller.showPuzzleList();
                }}>go to the program inventory</a>.</p>
            </>,
        });
    }

    private setStateFlags(newStateFlags: StateFlags): void {
        this.stateFlags = newStateFlags;

        const running = !!(newStateFlags & StateFlags.running);
        let success = false;
        let stateLabel = "Stopped";
        const error = !!(newStateFlags & StateFlags.error);
        if ((newStateFlags & StateFlags.done) && !error) {
            success = true;
            stateLabel = "Completed";
        } else if (running) {
            stateLabel = "Running"
        }

        this.setState({ stateLabel });

        if (success) {
            // TODO: Mark as solved in persistent state
            this.showSuccessMessageBox();
        }

        this.autoStep = this.autoStep && (running && !success && !error);
    }

    private setStateFlag(flag: StateFlags, on: boolean = true): void {
        if (on === false) {
            this.setStateFlags(this.stateFlags & ~flag);
        } else {
            this.setStateFlags(this.stateFlags | flag);
        }
    }

    private updateMemory(address: number, value: number): void {
        this.setState({ [address]: value });
    }

    private load = () => {
        try {
            const sourceLines = this.inputCode.current.value.split("\n");
            this.setState({ sourceLines });

            this.setStateFlags(StateFlags.none);

            let inputIndex = 0;
            let outputIndex = 0;
            let done = false;
            const assembledProgram = Assembler.assemble(sourceLines);

            this.programBytes = assembledProgram.bytes.slice();
            this.emulator = new Emulator(assembledProgram, {
                readInput: () => {
                    var value = (inputIndex < this.props.inputBytes.length) ? this.props.inputBytes[inputIndex] : 0;
                    inputIndex++;
                    return value;
                },

                writeOutput: (value) => {
                    if (outputIndex < this.props.expectedOutputBytes.length) {
                        this.setState(state => ({ actualOutputBytes: [...state.actualOutputBytes, value] }));

                        if (value !== this.props.expectedOutputBytes[outputIndex]) {
                            this.setStateFlag(StateFlags.error);
                            const index = outputIndex;
                            this.setState(state => {
                                const unexpectedOutputIndexes = {};
                                for (let key in state.unexpectedOutputIndexes) {
                                    unexpectedOutputIndexes[key] = state.unexpectedOutputIndexes[key];
                                }
                                unexpectedOutputIndexes[index] = true;
                                return { unexpectedOutputIndexes };
                            });
                        }

                        if (++outputIndex == this.props.expectedOutputBytes.length) {
                            done = true;
                        }
                    }
                },

                onWriteMemory: (address, value) => {
                    this.updateMemory(address, value);
                },

                onStateUpdated: (data) => {
                    this.setStateFlag(StateFlags.running, data.running);
                    this.setState({
                        cyclesExecuted: data.cyclesExecuted,
                        memoryBytesAccessed: data.memoryBytesAccessed,
                        currentSourceLine: (data.ip <= Constants.addressUserMax) ? data.sourceLineNumber : undefined,
                        currentAddress: data.ip,
                        variables: data.variables,
                    });

                    if (done) {
                        this.setStateFlag(StateFlags.done);
                    }
                },
            });
        } catch (error) {
            if (error instanceof CompilationError) {
                this.props.controller.showMessageBox({
                    title: "Compilation Error",
                    body: <>
                        <h2>Compilation Error!</h2>
                        <p>{error.message}</p>
                    </>,
                })
            } else {
                throw error;
            }
        }
    }

    private stepInternal() {
        if (this.emulator) {
            this.emulator.step();
        }
    }

    private step = () => {
        this.autoStep = false;
        this.stepInternal();
    }

    private clearInterval() {
        if (this.runToken !== undefined) {
            clearInterval(this.runToken);
            this.runToken = undefined;
        }
    }

    private runCallback = () => {
        if (this.autoStep) {
            this.stepInternal();
        } else {
            this.clearInterval();
        }
    }

    private run = () => {
        this.autoStep = true;
        this.runToken = setInterval(this.runCallback, Sic1Ide.autoStepIntervalMS);
    }

    private menu = () => {
        this.autoStep = false;
        this.props.controller.showPuzzleList();
    }

    public isRunning(): boolean {
        return !!(this.stateFlags & StateFlags.running);
    }

    public isExecuting(): boolean {
        return this.autoStep;
    }

    public reset() {
        this.setState(Sic1Ide.createEmptyTransientState());
        this.setStateFlags(StateFlags.none);
    }

    public pause = () => {
        this.autoStep = false;
    }

    public stop = () => {
        this.autoStep = false;
        this.reset();
        this.setStateFlags(StateFlags.none);
    }

    public componentDidMount() {
        this.reset();
    }

    public componentWillUnmount() {
        this.clearInterval();
    }

    public render() {
        return <div className="ide">
            <div className="controls">
                <table>
                    <tr><th>{this.props.puzzle.title}</th></tr>
                    <tr><td className="text">{this.props.puzzle.description}</td></tr>
                </table>
                <br />
                <div className="ioBox">
                    <table>
                        <thead><tr><th>In</th><th>Expected</th><th>Actual</th></tr></thead>
                        <tbody>
                            {
                                this.getLongestIOTable().map((x, index) => <tr>
                                    <td>{(index < this.props.inputBytes.length) ? this.props.inputBytes[index] : null}</td>
                                    <td className={this.state.unexpectedOutputIndexes[index] ? "attention" : ""}>{(index < this.props.expectedOutputBytes.length) ? this.props.expectedOutputBytes[index] : null}</td>
                                    <td className={this.state.unexpectedOutputIndexes[index] ? "attention" : ""}>{(index < this.state.actualOutputBytes.length) ? this.state.actualOutputBytes[index] : null}</td>
                                </tr>)
                            }
                        </tbody>
                    </table>
                </div>
                <br />
                <table>
                    <tr><th className="horizontal">State</th><td>{this.state.stateLabel}</td></tr>
                    <tr><th className="horizontal">Cycles</th><td>{this.state.cyclesExecuted}</td></tr>
                    <tr><th className="horizontal">Bytes</th><td>{this.state.memoryBytesAccessed}</td></tr>
                </table>
                <br />
                <button onClick={this.load} disabled={this.isRunning()}>Load</button>
                <button onClick={this.stop} disabled={!this.isRunning()}>Stop</button>
                <button onClick={this.step} disabled={!this.isRunning()}>Step</button>
                <button onClick={this.run} disabled={!this.isRunning()}>Run</button>
                <button onClick={this.menu}>Menu</button>
            </div>
            <div className="program">
                <textarea ref={this.inputCode} key={this.props.puzzle.title} className={"input" + (this.isRunning() ? " hidden" : "")} spellCheck={false} wrap="off" defaultValue={Sic1Ide.getDefaultCode(this.props.puzzle)}></textarea>
                <div className={"source" + (this.isRunning() ? "" : " hidden")}>
                    {
                        this.state.sourceLines.map((line, index) => {
                            if (/\S/.test(line)) {
                                return <div className={(index === this.state.currentSourceLine) ? "emphasize" : ""}>{line}</div>;
                            } else {
                                return <br />
                            }
                        })
                    }
                </div>
            </div>
            <div>
                <table className="memory"><tr><th colSpan={16}>Memory</th></tr>
                {
                    this.memoryMap.map(row => <tr>{row.map(index => <td className={(index >= this.state.currentAddress && index < this.state.currentAddress + Constants.subleqInstructionBytes) ? "emphasize" : ""}>{Sic1Ide.hexifyByte(this.state[index])}</td>)}</tr>)
                }
                </table>
                <br />
                <table className={this.state.variables.length > 0 ? "" : "hidden"}>
                    <thead><tr><th>Label</th><th>Value</th></tr></thead>
                    <tbody>
                        {
                            this.state.variables.map(v => <tr>
                                <td className="text">{v.label}</td>
                                <td>{v.value}</td>
                            </tr>)
                        }
                    </tbody>
                </table>
            </div>
        </div>;
    }
}

class Sic1Intro extends React.Component<{ onCompleted: (name: string) => void }> {
    private inputName = React.createRef<HTMLInputElement>();

    public render() {
        return <>
            <h1>Welcome to SIC Systems!</h1>
            <h2>Job Description</h2>
            <p>SIC Systems is looking for programmers to produce highly efficient programs for their flagship product: the Single Instruction Computer Mark 1 (SIC-1).</p>
            <p>Note that you will be competing against other engineers to produce the fastest and smallest programs.</p>
            <h2>Job Application</h2>
            <p>Please provide your name:</p>
            <p><input ref={this.inputName} defaultValue={Sic1DataManager.defaultName} /></p>
            <p>Then click this link to: <a href="#" onClick={(event) => {
                event.preventDefault();
                this.props.onCompleted(this.inputName.current.value)
            }}>apply for the job</a>.</p>
        </>;
    }
}

interface Sic1RootPuzzleState {
    puzzle: Puzzle;
    inputBytes: number[];
    expectedOutputBytes: number[];
}

interface Sic1RootState extends Sic1RootPuzzleState {
    messageBoxContent?: MessageBoxContent;
}

class Sic1Root extends React.Component<{}, Sic1RootState> implements Sic1Controller {
    private ide = React.createRef<Sic1Ide>();

    constructor(props) {
        super(props);
        // TODO: Load previous puzzle
        this.state = Sic1Root.getStateForPuzzle(puzzles[0].list[1]);
    }

    private static getStateForPuzzle(puzzle: Puzzle): Sic1RootPuzzleState {
        // TODO: Shuffle order
        const inputBytes = [].concat(...puzzle.io.map(row => row[0]));
        const expectedOutputBytes = [].concat(...puzzle.io.map(row => row[1]));
        return {
            puzzle,
            inputBytes,
            expectedOutputBytes,
        }
    }

    private loadPuzzle(puzzle: Puzzle): void {
        // TODO: Save previous puzzle progress, if applicable
        // TODO: Save as last open puzzle
        // TODO: Mark puzzle as viewed
        // TODO: Load new puzzle progress (or fallback to default)

        this.setState(Sic1Root.getStateForPuzzle(puzzle));
        if (this.ide.current) {
            this.ide.current.reset();
        }
        this.closeMessageBox();
    }

    private keyUpHandler = (event: KeyboardEvent) => {
        if (event.keyCode === 27) { // Escape key
            if (this.ide.current && this.ide.current.isExecuting()) {
                this.ide.current.pause();
            } else if (this.ide.current && this.ide.current.isRunning()) {
                this.ide.current.stop();
            } else if (this.state.messageBoxContent && this.state.messageBoxContent.modal !== false) {
                this.closeMessageBox();
            } else {
                this.showPuzzleList();
            }
        }
    }

    private showIntro2(name: string) {
        this.setState({ messageBoxContent: {
            title: "You're Hired!",
            body: <>
                <h2>Congratulations!</h2>
                <p>Congratulations, {name}! SIC Systems has accepted your application. Introductory information and your first assignment are below.</p>
                <h2>Introducing the SIC-1</h2>
                <p>The SIC-1 represents a transformational change in computing, reducing complexity to the point that the processor only executes a single instruction: subtract and branch if less than or equal to zero ("subleq").</p>
                <p>Note that you can view the program inventory by clicking the "Menu" button or hitting ESC.</p>
                <p>Click this link to: <a href="#" onClick={(event) => {
                    event.preventDefault();

                    const data = Sic1DataManager.getData();
                    data.name = name;
                    data.introCompleted = true;
                    Sic1DataManager.saveData();

                    this.loadPuzzle(puzzles[0].list[0]);
                    this.closeMessageBox();
                }}>get started with your first SIC-1 program</a>.</p>
            </>,
        }});
    }

    private showIntro() {
        this.setState({ messageBoxContent: {
            title: "Welcome!",
            body: <><Sic1Intro onCompleted={(name) => this.showIntro2(name)} /></>,
        }});
    }

    private showResume() {
        // TODO: Load user stats
        this.setState({ messageBoxContent: {
            title: "Welcome Back!",
            body: <>
                <h2>Welcome back, {Sic1DataManager.getData().name}!</h2>
                <p>For motivational purposes, here is how the number of tasks you've completed compares to other engineers.</p>
                <Chart chartState={ChartState.loading} title="Completed Tasks" highlightedValue={Sic1DataManager.getData().solvedCount} />
                <p>Click this link to: <a href="#" onClick={(event) => {
                    event.preventDefault();
                    this.showPuzzleList();
                }}>go to the program inventory</a>.</p>
            </>,
        }});
    }

    private start() {
        const data = Sic1DataManager.getData();
        if (data.introCompleted) {
            this.showResume();
        } else {
            this.showIntro();
        }
    }

    private filterUnlockedPuzzles(list: Puzzle[]) {
        const data = Sic1DataManager.getData();
        return list
            .map(puzzle => {
                const puzzleData = Sic1DataManager.getPuzzleData(puzzle.title);

                // Check for unlock
                if (!puzzleData.unlocked) {
                    if (data.solvedCount >= puzzle.minimumSolvedToUnlock) {
                        puzzleData.unlocked = true;
                        Sic1DataManager.savePuzzleData(puzzle.title);
                    }
                }

                if (puzzleData.unlocked) {
                    return {
                        puzzle,
                        puzzleData,
                    };
                }
                return null;
            })
            .filter(puzzleInfo => !!puzzleInfo);
    }

    private createPuzzleLink(puzzleInfo: { puzzle: Puzzle, puzzleData: PuzzleData }): React.ReactFragment {
        const { puzzle, puzzleData } = puzzleInfo;
        return <a href="#" onClick={(event) => {
            event.preventDefault();
            this.loadPuzzle(puzzle);
        }}>{puzzle.title}{
            (puzzleData.solved && puzzleData.solutionCycles && puzzleData.solutionBytes)
            ? ` (SOLVED; cycles: ${puzzleData.solutionCycles}, bytes: ${puzzleData.solutionBytes})`
            : (
                (!puzzleData.viewed)
                ? " (NEW)"
                : ""
            )
        }</a>;
    }

    public showPuzzleList() {
        // Filter to unlocked groups and puzzles
        let groupInfos = puzzles.map(group => ({
            group,
            puzzleInfos: this.filterUnlockedPuzzles(group.list),
        })).filter(groupInfo => (groupInfo.puzzleInfos.length > 0));

        this.setState({ messageBoxContent: {
            title: "Program Inventory",
            body: <>
                <p>SIC Systems requires you to implement the following programs:</p>
                {groupInfos.map(groupInfo => <ol>
                    <li>
                        {groupInfo.group.groupTitle}
                        <ol>
                            {groupInfo.puzzleInfos.map(puzzleInfo => <li>{this.createPuzzleLink(puzzleInfo)}</li>)}
                        </ol>
                    </li>
                </ol>)}
            </>,
        }});
    }

    public showMessageBox(messageBoxContent: MessageBoxContent) {
        this.setState({ messageBoxContent });
    }

    public closeMessageBox() {
        this.setState({ messageBoxContent: null });
    }

    public componentDidMount() {
        window.addEventListener("keyup", this.keyUpHandler);
        this.start();
    }

    public componentWillUnmount() {
        window.removeEventListener("keyup", this.keyUpHandler);
    }

    public render() {
        const messageBoxContent = this.state.messageBoxContent;
        return <>
            <Sic1Ide ref={this.ide} puzzle={this.state.puzzle} inputBytes={this.state.inputBytes} expectedOutputBytes={this.state.expectedOutputBytes} controller={this} />
            {messageBoxContent ? <MessageBox title={messageBoxContent.title} modal={messageBoxContent.modal} body={messageBoxContent.body} messageBoxManager={this} /> : null}
        </>;
    }
}

ReactDOM.render(<Sic1Root />, document.getElementById("root"));
