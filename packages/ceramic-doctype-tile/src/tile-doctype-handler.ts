import CID from 'cids'

import * as didJwt from 'did-jwt'

import jsonpatch from 'fast-json-patch'

import { TileDoctype, TileParams } from "./tile-doctype"
import {
    AnchorProof, AnchorRecord, AnchorStatus, DocState, DoctypeConstructor, DoctypeHandler, DocOpts, SignatureStatus
} from "@ceramicnetwork/ceramic-common"
import { Context } from "@ceramicnetwork/ceramic-common"

const DOCTYPE = 'tile'

/**
 * Tile doctype handler implementation
 */
export class TileDoctypeHandler implements DoctypeHandler<TileDoctype> {
    /**
     * Gets doctype name
     */
    get name(): string {
        return DOCTYPE
    }

    /**
     * Gets doctype class
     */
    get doctype(): DoctypeConstructor<TileDoctype> {
        return TileDoctype
    }

    /**
     * Create new Tile doctype instance
     * @param params - Create parameters
     * @param context - Ceramic context
     * @param opts - Initialization options
     */
    async create(params: TileParams, context: Context, opts?: DocOpts): Promise<TileDoctype> {
        return TileDoctype.create(params, context, opts)
    }

    /**
     * Applies record (genesis|signed|anchor)
     * @param record - Record
     * @param cid - Record CID
     * @param context - Ceramic context
     * @param state - Document state
     */
    async applyRecord(record: any, cid: CID, context: Context, state?: DocState): Promise<DocState> {
        if (state == null) {
            // apply genesis
            return this._applyGenesis(record, cid, context)
        }

        if (record.proof) {
            const proofRecord = (await context.ipfs.dag.get(record.proof)).value;
            return this._applyAnchor(record, proofRecord, cid, state);
        }

        return this._applySigned(record, cid, state, context)
    }

    /**
     * Applies genesis record
     * @param record - Genesis record
     * @param cid - Genesis record CID
     * @param context - Ceramic context
     * @private
     */
    async _applyGenesis(record: any, cid: CID, context: Context): Promise<DocState> {
        await this._verifyRecordSignature(record, context)
        // TODO - verify genesis record
        return {
            doctype: DOCTYPE,
            content: record.data,
            metadata: record.header,
            next: {
                content: null,
            },
            signature: SignatureStatus.SIGNED,
            anchorStatus: AnchorStatus.NOT_REQUESTED,
            log: [cid]
        }
    }

    /**
     * Applies signed record
     * @param record - Signed record
     * @param cid - Signed record CID
     * @param state - Document state
     * @param context - Ceramic context
     * @private
     */
    async _applySigned(record: any, cid: CID, state: DocState, context: Context): Promise<DocState> {
        if (!record.id.equals(state.log[0])) {
            throw new Error(`Invalid docId ${record.id}, expected ${state.log[0]}`)
        }
        await this._verifyRecordSignature(record, context)
        state.log.push(cid)
        return {
            ...state,
            signature: SignatureStatus.SIGNED,
            anchorStatus: AnchorStatus.NOT_REQUESTED,
            next: {
                content: jsonpatch.applyPatch(state.content, record.data).newDocument,
            }
        }
    }

    /**
     * Applies anchor record
     * @param record - Anchor record
     * @param proof - Anchor record proof
     * @param cid - Anchor record CID
     * @param state - Document state
     * @private
     */
    async _applyAnchor(record: AnchorRecord, proof: AnchorProof, cid: CID, state: DocState): Promise<DocState> {
        state.log.push(cid)
        let content = state.content
        if (state.next?.content) {
            content = state.next.content
            delete state.next.content
        }
        return {
            ...state, content, anchorStatus: AnchorStatus.ANCHORED, anchorProof: proof,
        }
    }

    /**
     * Verifies record signature
     * @param record - Record to be verified
     * @param context - Ceramic context
     * @private
     */
    async _verifyRecordSignature(record: any, context: Context): Promise<void> {
        // reconstruct jwt
        const { signedHeader, signature } = record
        delete record.signedHeader
        delete record.signature
        let payload = Buffer.from(JSON.stringify({
            doctype: record.doctype,
            data: record.data,
            header: record.header,
            unique: record.unique || undefined,
            prev: record.prev ? { '/': record.prev.toString() } : undefined,
            id: record.id ? { '/': record.id.toString() } : undefined,
            iss: record.iss
        })).toString('base64')
        payload = payload.replace(/=/g, '')
        const jwt = [signedHeader, payload, signature].join('.')
        try {
            await this.verifyJWT(jwt, { resolver: context.resolver })
        } catch (e) {
            throw new Error('Invalid signature for signed record. ' + e)
        }
    }

    /**
     * Verifies JWT token
     * @param jwt - JWT token
     * @param opts - verification options
     */
    async verifyJWT(jwt: string, opts: any): Promise<void> {
        await didJwt.verifyJWT(jwt, opts)
    }

}
