import { DeckBuilder } from "./cards/deck.builder";
import { Hero } from "./hero";
import { Player } from "./player";
import { CardWriter } from "./util/cardwriter";
import { readFileSync, writeFileSync} from "fs";
import { InFileLayout } from "../util/in.file";
import { LoggingHandler } from "../logging/logging.handler";
import { globalEvent } from "@billjs/event-emitter"
import { ValidMovesValidator } from "./moves/valid.moves.validator";
import { SimpleStrategy } from "./strategy/simple.strategy.";
import { ManaToken } from "./cards/data/mana.token";
import { CardModifierHelper } from "./cards/modifiers/modifier.helper";
import { StrategyMapper } from "./strategy/strategy.mapper";
import { GameData } from "../logging/game.data";

//TODO check that mana is increased or not correctly at the beginning of match
//TODO define manatokens effect
export class Game {
    private readonly PLAYER_HEALTH = 30;

    players : Array<Player>;
    logger : LoggingHandler;

    constructor() {
        this.players = new Array<Player>();
    }

    public play() {

        //Create generic heros, each with 30 health
        const heroOne = new Hero('HeroOne', this.PLAYER_HEALTH, 0, 0);
        const heroTwo = new Hero('HeroTwo', this.PLAYER_HEALTH, 0, 0);

        //Two players, each with a hero and a deck start at 30 health, add to player array
        const playerOne = new Player('PlayerOne', heroOne, 1, 0, 0)
        const playerTwo = new Player('PlayerTwo', heroTwo, 1, 0, 0)

        //Create and set decks from infile, shuffle for now
        const inFile : InFileLayout = JSON.parse(readFileSync('/golem/input/in.file.json', 'utf-8'));
        //const inFile : InFileLayout = JSON.parse(readFileSync('./in.file.json', 'utf-8'));
        const deckOne = new DeckBuilder(inFile.player1.deck, playerOne, playerTwo).getAsDeck();
        playerOne.setDeck(deckOne);
        const deckTwo = new DeckBuilder(inFile.player2.deck, playerTwo, playerOne).getAsDeck();
        playerTwo.setDeck(deckTwo);

        //Set player strategies from infile
        const strategyMapper : StrategyMapper = new StrategyMapper();
        playerOne.setStrategy(strategyMapper.getStrategyFromClass(inFile.player1.strategy));
        playerTwo.setStrategy(strategyMapper.getStrategyFromClass(inFile.player2.strategy));

        //Add players to overall players array
        this.players.push(playerOne);
        this.players.push(playerTwo);

        //List out deck contents into console
        console.log(playerOne.name + ' Deck: \n' + new CardWriter(playerOne.getDeck().getCards()).createCardString());
        console.log(playerTwo.name + ' Deck: \n' + new CardWriter(playerTwo.getDeck().getCards()).createCardString());

        //Create the logger for tracking game stats
        this.logger = new LoggingHandler(playerOne, playerTwo);

        //Determine which player goes first, which goes second
        const firstTurnPlayer = this.players[Math.floor(Math.random() * this.players.length)]
        const secondTurnPlayer = firstTurnPlayer == playerOne ? playerTwo : playerOne;
        console.log(firstTurnPlayer.name + ' will have the first turn, ' + secondTurnPlayer.name + ' will start with the coin.');
        
        //First turn player gets 3 cards
        firstTurnPlayer.drawCards(3);
        console.log('Hand: ' + new CardWriter(firstTurnPlayer.getHand()).createCardString());

        //Second turn player get 4 cards and the mana token
        secondTurnPlayer.drawCards(4);
        secondTurnPlayer.addCardToHand(this.createManaToken(secondTurnPlayer, firstTurnPlayer));
        console.log('Hand: ' + new CardWriter(secondTurnPlayer.getHand()).createCardString());

        //Players take turns until one dies 
        console.log('\n!!!!!!!!!!!!!! Starting a match !!!!!!!!!!!!!\n');
        let turnCount = 0;
        while(turnCount < 300) {
            turnCount++;
            //Let first player take their turn
            this.takeTurn(firstTurnPlayer, secondTurnPlayer);

            //Print out statuses
            this.printPlayerStatus(firstTurnPlayer);
            this.printPlayerStatus(secondTurnPlayer);

            //If a player died, end game
            if(this.isAPlayerDead()) {
                break;
            }

            //Let second player take turn
            this.takeTurn(secondTurnPlayer, firstTurnPlayer);

            //Print out statuses
            this.printPlayerStatus(secondTurnPlayer);
            this.printPlayerStatus(firstTurnPlayer);

            //If a player died, end game
            if(this.isAPlayerDead()) {
                break;
            }
        }

        //Calculate any final game stats
        globalEvent.fire('final_turn_count', {turns: turnCount});

        //Winner is determined
        this.determineWinner(playerOne, playerTwo);

        //Log final info
        console.log('A player has died');
        console.log('Turns passed: ' + turnCount);
        console.log('PlayerOne: ' + playerOne.getHero().hitpoints + ' PlayerTwo : ' + playerTwo.getHero().hitpoints);
        console.log('Game stats were: ' + JSON.stringify(this.logger.gameData));

        //Write game stats to file for requestor pickup
        writeFileSync('/golem/output/gamestats.json', JSON.stringify(this.logger.gameData));
    }
    
    /*
        Basic implementation for now:
            Play a monster if possible
            Attack opponents monsters if they have any
            Attack opponent
    */
    private takeTurn(currentPlayer : Player, opponent : Player) {
        globalEvent.fire("begin_turn", {currentPlayer : currentPlayer, opponent : opponent})

        //Increase and reset player mana
        currentPlayer.resetAndIncreaseMana();

        //Attempt to draw a card
        currentPlayer.drawCards(1);

        const validator = new ValidMovesValidator(currentPlayer, opponent);
        let validMoves = validator.getValidMoves();
        const playerStrategy = new SimpleStrategy();
        while(validMoves.length > 0) {
            //Get next best move from strategy and play it
            playerStrategy.setPossibleMovies(currentPlayer, opponent, validMoves);
            playerStrategy.getNextMove().make();

            //Clear all dead monsters
            currentPlayer.removeDeadCardsFromBoard();
            opponent.removeDeadCardsFromBoard();

            //Check if player died
            if(this.isAPlayerDead()) break;

            validMoves = validator.getValidMoves();
        }

        //At the end of turn, remove summoning sickness and fatigue for player's monsters
        currentPlayer.getBoard().removeAllSummonSick();
        currentPlayer.getBoard().unFatigueAllMonsters();
    }

    private isAPlayerDead(){
        return this.players.filter((player) => {
            return player.isDead();
        }).length > 0;
    }

    private printPlayerStatus(player : Player) {
        console.log('The status for ' + player.name + ' is:');
        console.log('Health: ' + player.getHero().hitpoints);
        console.log('Board: ' + new CardWriter(player.getBoard().getCards()).createCardString());
        console.log('Hand: ' + new CardWriter(player.getHand()).createCardString());
        console.log('Deck: ' + new CardWriter(player.getDeck().getCards()).createCardString());
    }

    private determineWinner(player : Player, otherPlayer : Player) {
        let winner = '';

        if(player.isDead() && otherPlayer.isDead()) {
            winner = GameData.TIE;
        } else if (player.isDead()) {
            winner = otherPlayer.name;
        } else {
            winner = player.name;
        }

        globalEvent.fire('winner_decided', {winner : winner});
    }

    //Creates and prepares the mana token (TODO: eww)
    private createManaToken(player : Player, opponent : Player) : ManaToken {
        const token = new ManaToken();
        new CardModifierHelper(player, opponent, token).prepareCardModifiers();
        return token;
    }
}